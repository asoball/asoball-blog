import type {
  PublisherQueue,
  PublishJob,
  ActiveRelease,
  PublishState,
} from "./queue";
import { jobs, states } from "./queue";
import type { z } from "zod";
import { releaseSchema } from "./firebase";

type RemoteRelease = z.infer<typeof releaseSchema>;
export type PendingActivation = NonNullable<PublishState["cloudPending"]>;
export interface CloudWorkerOptions {
  site: string;
  prepare(
    job: PublishJob,
    fence: number,
    checkpoint: (details: Record<string, string>) => Promise<void>,
  ): Promise<{ version: string; active: ActiveRelease }>;
  publish(version: string, message: string): Promise<RemoteRelease>;
  latest(): Promise<RemoteRelease | undefined>;
}
async function finishPending(
  queue: PublisherQueue,
  pending: PendingActivation,
  release: RemoteRelease,
) {
  if (
    !pending.active ||
    release.version.name !== pending.version ||
    release.message !== pending.message
  )
    throw new Error("Remote activation mismatch.");
  const session = queue.client.startSession();
  try {
    await session.withTransaction(async () => {
      const result = await states(queue.db).updateOne(
        {
          _id: "state",
          "cloudPending.owner": pending.owner,
          "cloudPending.fence": pending.fence,
          "cloudPending.version": pending.version,
        },
        {
          $unset: { cloudPending: "" },
          $set: { active: pending.active!, remoteRelease: release, lock: null },
        },
        { session },
      );
      if (!result.matchedCount)
        throw new Error("Activation state changed; reconciliation required.");
      await jobs(queue.db).updateOne(
        { seq: pending.seq },
        {
          $set: {
            state: "succeeded",
            releaseId: pending.active!.releaseId,
            hostingVersion: pending.version,
            hostingRelease: release.name,
          },
          $unset: { errorCode: "" },
        },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
}
export async function reconcileCloud(
  queue: PublisherQueue,
  options: Pick<CloudWorkerOptions, "latest" | "site">,
) {
  const state = await states(queue.db).findOne({ _id: "state" });
  const pending = state?.cloudPending;
  if (!pending) return "ready" as const;
  // An execution may still be activating. Never clear its permit or release its lock.
  if (state.lock && state.lock.expiresAt > new Date()) return "busy" as const;
  if (
    pending.site !== options.site ||
    !pending.version ||
    !pending.message ||
    !pending.active
  )
    return "blocked" as const;
  const release = await options.latest();
  if (
    release?.version.name !== pending.version ||
    release.message !== pending.message
  ) {
    await jobs(queue.db).updateOne(
      { seq: pending.seq },
      { $set: { errorCode: "ACTIVATION_PENDING_RECONCILIATION" } },
    );
    return "blocked" as const;
  }
  await finishPending(queue, pending, release);
  return "reconciled" as const;
}
export async function runCloudOnce(
  queue: PublisherQueue,
  options: CloudWorkerOptions,
) {
  const reconciliation = await reconcileCloud(queue, options);
  if (reconciliation === "blocked" || reconciliation === "busy")
    return { state: reconciliation };
  const lease = await queue.acquire();
  if (!lease) return { state: "busy" };
  let lost = false,
    heartbeating = false;
  const timer = setInterval(
    async () => {
      if (heartbeating) return;
      heartbeating = true;
      try {
        if (!(await queue.heartbeat(lease.fence))) lost = true;
      } catch {
        lost = true;
      } finally {
        heartbeating = false;
      }
    },
    Math.max(100, Math.floor(queue.leaseMs / 3)),
  );
  let job: PublishJob | null = null;
  try {
    job = await queue.claim(lease.fence);
    if (!job) return { state: "idle" };
    const checkpoint = async (details: Record<string, string>) => {
      if (lost || !(await queue.owned(lease.fence)))
        throw new Error("Lease lost.");
      await jobs(queue.db).updateOne(
        { _id: job!._id, state: "running", runningFence: lease.fence },
        { $set: details },
      );
    };
    const { version, active } = await options.prepare(
      job,
      lease.fence,
      checkpoint,
    );
    if (
      active.seq !== job.seq ||
      active.releaseId !==
        `release-${String(job.seq).padStart(10, "0")}-f${lease.fence}` ||
      !new RegExp(`^sites/${options.site}/versions/[a-zA-Z0-9-]+$`).test(
        version,
      )
    )
      throw new Error("Invalid activation plan.");
    const message = `seq=${job.seq};fence=${lease.fence};release=${active.releaseId}`;
    const pending: PendingActivation = {
      owner: queue.owner,
      seq: job.seq,
      fence: lease.fence,
      site: options.site,
      version,
      message,
      active,
    };
    const reserved =
      !lost &&
      (
        await states(queue.db).updateOne(
          {
            _id: "state",
            desired: job.seq,
            fence: lease.fence,
            "lock.owner": queue.owner,
            "lock.expiresAt": { $gt: new Date() },
            cloudPending: { $exists: false },
          },
          { $set: { cloudPending: pending } },
        )
      ).matchedCount === 1;
    if (!reserved) {
      const state = await states(queue.db).findOne({ _id: "state" });
      // Lease loss is retryable, not evidence that a newer content request exists.
      if (!state || state.desired === job.seq)
        throw new Error("Activation lease lost.");
      await jobs(queue.db).updateOne(
        { _id: job._id, runningFence: lease.fence },
        { $set: { state: "superseded" } },
      );
      return { state: "superseded", seq: job.seq };
    }
    // No automatic POST retry: the durable permit blocks successors until outcome is known.
    const remote = await options.publish(version, message);
    await finishPending(queue, pending, remote);
    return { state: "succeeded", seq: job.seq, releaseId: active.releaseId };
  } catch {
    const pending = (await states(queue.db).findOne({ _id: "state" }))
      ?.cloudPending;
    if (pending) {
      if (job)
        await jobs(queue.db).updateOne(
          { _id: job._id },
          { $set: { errorCode: "ACTIVATION_PENDING_RECONCILIATION" } },
        );
      return { state: "blocked", seq: job?.seq };
    }
    if (job) await queue.fail(job, lease.fence);
    return {
      state: "failed",
      seq: job?.seq,
      errorCode: "BUILD_OR_EXPORT_FAILED",
    };
  } finally {
    clearInterval(timer);
    while (heartbeating)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await queue.release(lease.fence);
  }
}
