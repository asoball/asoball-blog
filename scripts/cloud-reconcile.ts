import { PublisherQueue, jobs, states } from "@asoball/publishing/queue";
import { cloudPublishingConfig } from "./cloud-publishing-config";
import { loadCmsEnvironment } from "../apps/cms/src/environment-file";
import { googleTransport } from "../packages/publishing/src/google-transport";
import { latestFirebaseRelease } from "../packages/publishing/src/firebase";
import { reconcileCloud } from "../packages/publishing/src/cloud-worker";

loadCmsEnvironment();
const config = cloudPublishingConfig(process.env);
const fence = Number(
  process.argv.find((arg) => arg.startsWith("--fence="))?.slice(8),
);
if (process.argv.includes("--plan")) {
  console.log(
    JSON.stringify({
      project: config.CLOUD_PROJECT_ID,
      site: config.FIREBASE_SITE_ID,
      fence: Number.isSafeInteger(fence) ? fence : null,
      networkCalls: false,
      action:
        "Inspect remote activation; clearing requires paused scheduler, no in-flight executions, exact fence and explicit confirmation.",
    }),
  );
  process.exit(0);
}
const transport = await googleTransport();
const queue = await new PublisherQueue(config.DATABASE_URI).open();
try {
  const result = await reconcileCloud(queue, {
    site: config.FIREBASE_SITE_ID,
    latest: () => latestFirebaseRelease(config.FIREBASE_SITE_ID, transport),
  });
  if (result !== "blocked" || !process.argv.includes("--confirm-not-applied")) {
    console.log(JSON.stringify({ state: result }));
    if (result === "blocked") process.exitCode = 1;
  } else {
    if (
      config.CLOUD_PUBLISH_ENABLED !== "false" ||
      !process.argv.includes("--confirm-no-inflight") ||
      !Number.isSafeInteger(fence) ||
      fence < 1
    )
      throw new Error(
        "Pause all publishers and confirm the exact pending fence before recovery.",
      );
    const state = await states(queue.db).findOne({ _id: "state" });
    if (
      !state?.cloudPending ||
      state.cloudPending.fence !== fence ||
      state.cloudPending.site !== config.FIREBASE_SITE_ID ||
      (state.lock && state.lock.expiresAt > new Date())
    )
      throw new Error("Pending activation changed or lease still active.");
    const pending = state.cloudPending;
    const session = queue.client.startSession();
    try {
      await session.withTransaction(async () => {
        const resolved = await states(queue.db).updateOne(
          {
            _id: "state",
            "cloudPending.fence": fence,
            "cloudPending.owner": pending.owner,
            $or: [{ lock: null }, { "lock.expiresAt": { $lte: new Date() } }],
          },
          {
            $unset: { cloudPending: "" },
            $set: {
              lock: null,
              lastCloudRecovery: {
                fence,
                seq: pending.seq,
                outcome: "operator-confirmed-not-applied",
                at: new Date(),
              },
            },
          },
          { session },
        );
        if (resolved.matchedCount !== 1)
          throw new Error("Pending activation changed.");
        await jobs(queue.db).updateOne(
          { seq: pending.seq },
          {
            $set: {
              state: "failed",
              errorCode: "ACTIVATION_NOT_APPLIED_CONFIRMED",
            },
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    console.log(
      JSON.stringify({
        state: "resolved-not-applied",
        fence,
        seq: pending.seq,
      }),
    );
  }
} finally {
  await queue.close();
}
