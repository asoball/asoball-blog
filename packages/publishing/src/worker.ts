import { createHash, randomUUID } from "node:crypto";
import {
  open,
  readFile,
  writeFile,
  rename,
  unlink,
  mkdir,
  readdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  PublisherQueue,
  jobs,
  states,
  type ActiveRelease,
  type PublishJob,
} from "./queue";
import { exportSnapshot } from "./snapshot";
export const validReleaseId = (value: string) =>
  /^release-\d{10}-f\d+$/.test(value);
export async function directoryDigest(directory: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(folder: string) {
    const entries = await readdir(folder, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const item of entries) {
      const file = path.join(folder, item.name);
      if (item.isDirectory()) await walk(file);
      else if (item.isFile()) {
        hash.update(path.relative(directory, file).replaceAll("\\", "/"));
        hash.update(await readFile(file));
      } else
        throw new Error("Release contains unsupported filesystem entries.");
    }
  }
  await walk(directory);
  return hash.digest("hex");
}
export async function fingerprint(root: string) {
  const hash = createHash("sha256");
  async function walk(folder: string) {
    const entries = await readdir(folder, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if (
        ["node_modules", ".next", ".astro", "dist", "tests", ".local"].includes(
          entry.name,
        ) ||
        entry.name.startsWith(".env") ||
        entry.name.endsWith(".tsbuildinfo") ||
        entry.name.endsWith(".test.ts")
      )
        continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (
        /\.(?:ts|tsx|astro|js|mjs|cjs|json|css|svg|png|yaml)$/.test(entry.name)
      ) {
        hash.update(path.relative(root, full).replaceAll("\\", "/"));
        hash.update(await readFile(full));
      }
    }
  }
  for (const folder of ["apps", "packages", "scripts"])
    await walk(path.join(root, folder));
  for (const file of ["package.json", "pnpm-lock.yaml"])
    hash.update(await readFile(path.join(root, file)));
  return hash.digest("hex");
}
export async function withActivationLock<T>(
  dataDir: string,
  action: () => Promise<T>,
): Promise<T> {
  await mkdir(dataDir, { recursive: true });
  const lockFile = path.join(dataDir, "activation.lock");
  const deadline = Date.now() + 30000;
  let handle;
  while (!handle) {
    try {
      handle = await open(lockFile, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() > deadline)
        throw new Error(
          "Activation lock is held; inspect worker status before recovery.",
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await handle.writeFile(
    JSON.stringify({
      pid: process.pid,
      host: os.hostname(),
      token: randomUUID(),
    }),
  );
  try {
    return await action();
  } finally {
    await handle.close();
    await unlink(lockFile);
  }
}
export async function writeActive(dataDir: string, active: ActiveRelease) {
  if (!validReleaseId(active.releaseId))
    throw new Error("Invalid release pointer.");
  const temp = path.join(dataDir, `active-${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(active), { flag: "wx" });
  await rename(temp, path.join(dataDir, "active.json"));
}
export type BuildOptions = {
  snapshotFile: string;
  siteDir: string;
  job?: PublishJob;
};
export type WorkerOptions = {
  uri: string;
  dataDir: string;
  repoRoot: string;
  build: (options: BuildOptions) => Promise<void>;
  mediaDriver?: "local" | "gcs";
  bucket?: string;
};
export async function runOnce(queue: PublisherQueue, options: WorkerOptions) {
  const lease = await queue.acquire();
  if (!lease) return { state: "busy" as const };
  let heartbeatRunning = false,
    lost = false;
  const heartbeat = setInterval(
    async () => {
      if (heartbeatRunning) return;
      heartbeatRunning = true;
      try {
        if (!(await queue.heartbeat(lease.fence))) lost = true;
      } catch {
        lost = true;
      } finally {
        heartbeatRunning = false;
      }
    },
    Math.max(100, Math.floor(queue.leaseMs / 3)),
  );
  let job: PublishJob | null = null;
  try {
    job = await queue.claim(lease.fence);
    if (!job) return { state: "idle" as const };
    const releaseId = `release-${String(job.seq).padStart(10, "0")}-f${lease.fence}`;
    const snapshotDir = path.join(
      options.dataDir,
      "snapshots",
      `release-${String(job.seq).padStart(10, "0")}`,
    );
    const releaseDir = path.join(options.dataDir, "releases", releaseId),
      siteDir = path.join(releaseDir, "site");
    await exportSnapshot({
      uri: options.uri,
      actor: job.actor,
      directory: snapshotDir,
      dataDir: options.dataDir,
      mediaDriver: options.mediaDriver,
      bucket: options.bucket,
    });
    const snapshotFile = path.join(snapshotDir, "snapshot.json"),
      sourceDigest = await fingerprint(options.repoRoot);
    await options.build({ snapshotFile, siteDir, job });
    await stat(path.join(siteDir, "index.html"));
    if (sourceDigest !== (await fingerprint(options.repoRoot)))
      throw new Error("Source changed while building.");
    const snapshotDigest = createHash("sha256")
      .update(await readFile(snapshotFile))
      .digest("hex");
    const active: ActiveRelease = {
      releaseId,
      seq: job.seq,
      sourceDigest,
      snapshotDigest,
      siteDigest: await directoryDigest(siteDir),
      activatedAt: new Date().toISOString(),
    };
    await mkdir(releaseDir, { recursive: true });
    await writeFile(
      path.join(releaseDir, "manifest.json"),
      JSON.stringify(active, null, 2),
      { flag: "wx" },
    );
    const activated = await withActivationLock(options.dataDir, async () => {
      if (lost || !(await queue.activate(active, lease.fence))) return false;
      await writeActive(options.dataDir, active);
      return true;
    });
    await jobs(queue.db).updateOne(
      { _id: job._id, runningFence: lease.fence },
      { $set: { state: activated ? "succeeded" : "superseded", releaseId } },
    );
    return {
      state: activated ? ("succeeded" as const) : ("superseded" as const),
      releaseId,
      seq: job.seq,
    };
  } catch {
    if (job) await queue.fail(job, lease.fence);
    return {
      state: "failed" as const,
      seq: job?.seq,
      errorCode: "BUILD_OR_EXPORT_FAILED",
    };
  } finally {
    clearInterval(heartbeat);
    while (heartbeatRunning)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await queue.release(lease.fence);
  }
}
export async function reconcilePointer(queue: PublisherQueue, dataDir: string) {
  const lease = await queue.acquire();
  if (!lease) return { state: "busy" as const };
  try {
    await withActivationLock(dataDir, async () => {
      const state = await states(queue.db).findOne({ _id: "state" });
      if (state?.active) {
        await stat(
          path.join(
            dataDir,
            "releases",
            state.active.releaseId,
            "site",
            "index.html",
          ),
        );
        await writeActive(dataDir, state.active);
      }
    });
    return { state: "reconciled" as const };
  } finally {
    await queue.release(lease.fence);
  }
}
