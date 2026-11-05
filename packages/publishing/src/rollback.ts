import { ObjectId } from "mongodb";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { PublisherQueue, jobs, states, type ActiveRelease } from "./queue";
import {
  directoryDigest,
  validReleaseId,
  withActivationLock,
  writeActive,
} from "./worker";
import type { Actor } from "./snapshot";
export async function rollback(
  queue: PublisherQueue,
  dataDir: string,
  releaseId: string,
  actor: Actor,
) {
  if (!validReleaseId(releaseId))
    throw new Error("Invalid rollback release ID.");
  if (
    actor.role !== "admin" ||
    !ObjectId.isValid(actor.id) ||
    !(await queue.db
      .collection("users")
      .findOne({ _id: new ObjectId(actor.id), role: "admin" }))
  )
    throw new Error("Administrator required.");
  const lease = await queue.acquire();
  if (!lease) throw new Error("Publisher is busy; rollback was not performed.");
  try {
    return await withActivationLock(dataDir, async () => {
      const directory = path.join(dataDir, "releases", releaseId);
      const manifest = JSON.parse(
        await readFile(path.join(directory, "manifest.json"), "utf8"),
      ) as ActiveRelease;
      if (
        manifest.releaseId !== releaseId ||
        !manifest.siteDigest ||
        manifest.siteDigest !==
          (await directoryDigest(path.join(directory, "site")))
      )
        throw new Error("Rollback release failed integrity verification.");
      const session = queue.client.startSession();
      let active: ActiveRelease;
      try {
        active = await session.withTransaction(async () => {
          const state = await states(queue.db).findOneAndUpdate(
            {
              _id: "state",
              fence: lease.fence,
              "lock.owner": queue.owner,
              "lock.expiresAt": { $gt: new Date() },
            },
            { $inc: { desired: 1 } },
            { session, returnDocument: "after" },
          );
          if (!state) throw new Error("Rollback lease was lost.");
          const selected = {
            ...manifest,
            seq: state.desired,
            activatedAt: new Date().toISOString(),
          };
          await states(queue.db).updateOne(
            { _id: "state" },
            { $set: { active: selected } },
            { session },
          );
          await jobs(queue.db).updateMany(
            {
              seq: { $lt: state.desired },
              state: { $in: ["queued", "running"] },
            },
            { $set: { state: "superseded" } },
            { session },
          );
          await jobs(queue.db).insertOne(
            {
              _id: new ObjectId(),
              seq: state.desired,
              key: `rollback:${randomUUID()}`,
              actor,
              reason: "rollback",
              state: "succeeded",
              attempts: 1,
              availableAt: new Date(),
              createdAt: new Date(),
              releaseId,
            },
            { session },
          );
          return selected;
        });
      } finally {
        await session.endSession();
      }
      await writeActive(dataDir, active);
      return active;
    });
  } finally {
    await queue.release(lease.fence);
  }
}
export async function recoverDeadActivationLock(
  queue: PublisherQueue,
  dataDir: string,
) {
  const lease = await queue.acquire();
  if (!lease) throw new Error("Publisher is busy.");
  try {
    const file = path.join(dataDir, "activation.lock");
    const owner = JSON.parse(await readFile(file, "utf8")) as {
      pid: number;
      host: string;
    };
    if (
      owner.host !== os.hostname() ||
      !Number.isInteger(owner.pid) ||
      owner.pid <= 0
    )
      throw new Error("Cannot verify activation lock owner.");
    try {
      process.kill(owner.pid, 0);
      throw new Error("Activation lock owner is still alive.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    // Mongo lease excludes other publishers/recovery commands; the recorded owner is dead.
    await unlink(file);
    await withActivationLock(dataDir, async () => {
      const state = await states(queue.db).findOne({ _id: "state" });
      if (state?.active) await writeActive(dataDir, state.active);
    });
  } finally {
    await queue.release(lease.fence);
  }
}
