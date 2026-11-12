import { Storage } from "@google-cloud/storage";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { PublisherQueue } from "@asoball/publishing/queue";
import { exportSnapshot } from "@asoball/publishing/snapshot";
import { directoryDigest } from "@asoball/publishing/worker";
import { runCloudOnce } from "../packages/publishing/src/cloud-worker";
import {
  sha256,
  uploadDirectory,
  downloadCandidate,
} from "../packages/publishing/src/cloud-artifacts";
import {
  stageFirebaseVersion,
  releaseFirebaseVersion,
  latestFirebaseRelease,
  hostingApiConfig,
} from "../packages/publishing/src/firebase";
import { googleTransport } from "../packages/publishing/src/google-transport";
import {
  submitBuildCandidate,
  waitForCloudBuild,
  type CloudPlan,
} from "../packages/publishing/src/cloud";
import { checkArtifacts } from "./seo-check";
import { loadCmsEnvironment } from "../apps/cms/src/environment-file";
import { cloudPublishingConfig } from "./cloud-publishing-config";

loadCmsEnvironment();
const config = cloudPublishingConfig(process.env);
if (process.argv.includes("--plan")) {
  console.log(
    JSON.stringify({
      enabled: config.CLOUD_PUBLISH_ENABLED === "true",
      project: config.CLOUD_PROJECT_ID,
      region: config.CLOUD_REGION,
      trigger: config.CLOUD_BUILD_TRIGGER,
      source: config.CLOUD_SOURCE_SHA,
      site: config.FIREBASE_SITE_ID,
      snapshotBucket: config.CLOUD_SNAPSHOT_BUCKET,
      candidateBucket: config.CLOUD_CANDIDATE_BUCKET,
      networkCalls: false,
    }),
  );
  process.exit(0);
}
if (config.CLOUD_PUBLISH_ENABLED !== "true")
  throw new Error(
    "Cloud publisher disabled; review --plan and Console setup before enabling.",
  );
const transport = await googleTransport(),
  storage = new Storage();
const queue = await new PublisherQueue(config.DATABASE_URI).open();
try {
  const result = await runCloudOnce(queue, {
    site: config.FIREBASE_SITE_ID,
    latest: () => latestFirebaseRelease(config.FIREBASE_SITE_ID, transport),
    publish: (version, message) =>
      releaseFirebaseVersion(
        config.FIREBASE_SITE_ID,
        version,
        message,
        transport,
      ),
    prepare: async (job, fence, checkpoint) => {
      const releaseId = `release-${String(job.seq).padStart(10, "0")}-f${fence}`;
      const root = path.join(os.tmpdir(), "asoball-publisher", releaseId),
        snapshotDir = path.join(root, "snapshot"),
        siteDir = path.join(root, "site");
      await mkdir(root, { recursive: true });
      await exportSnapshot({
        uri: config.DATABASE_URI,
        actor: job.actor,
        directory: snapshotDir,
        dataDir: root,
        mediaDriver: "gcs",
        bucket: config.GCS_BUCKET,
      });
      const digest = sha256(
        await readFile(path.join(snapshotDir, "snapshot.json")),
      );
      const snapshotPrefix = `snapshots/${releaseId}`;
      await uploadDirectory(
        storage,
        config.CLOUD_SNAPSHOT_BUCKET,
        snapshotPrefix,
        snapshotDir,
      );
      const plan: CloudPlan = {
        projectId: config.CLOUD_PROJECT_ID,
        region: config.CLOUD_REGION,
        triggerId: config.CLOUD_BUILD_TRIGGER,
        commitSha: config.CLOUD_SOURCE_SHA,
        releaseId,
        snapshotUri: `gs://${config.CLOUD_SNAPSHOT_BUCKET}/${snapshotPrefix}/snapshot.json`,
        snapshotDigest: digest,
        candidateBucket: config.CLOUD_CANDIDATE_BUCKET,
        siteUrl: config.SITE_URL,
        seq: job.seq,
        fence,
      };
      const operation = await submitBuildCandidate(plan, transport, {
        enabled: true,
        ownsLease: () => queue.owned(fence),
      });
      const accepted = z
        .object({
          name: z.string(),
          metadata: z.object({ build: z.object({ id: z.string() }) }),
        })
        .parse(operation);
      await checkpoint({
        buildOperation: accepted.name,
        buildId: accepted.metadata.build.id,
      });
      await waitForCloudBuild(plan, operation, transport, {
        ownsLease: () => queue.owned(fence),
      });
      await downloadCandidate(
        storage,
        config.CLOUD_CANDIDATE_BUCKET,
        {
          releaseId,
          commit: config.CLOUD_SOURCE_SHA,
          sourceSnapshotDigest: digest,
        },
        siteDir,
      );
      await checkArtifacts(siteDir);
      const firebase = z
        .object({ hosting: z.unknown() })
        .parse(JSON.parse(await readFile("firebase.json", "utf8")));
      const version = await stageFirebaseVersion(
        config.FIREBASE_SITE_ID,
        siteDir,
        hostingApiConfig(firebase.hosting),
        transport,
      );
      await checkpoint({ hostingVersion: version });
      return {
        version,
        active: {
          releaseId,
          seq: job.seq,
          sourceDigest: config.CLOUD_SOURCE_SHA,
          snapshotDigest: digest,
          siteDigest: await directoryDigest(siteDir),
          activatedAt: new Date().toISOString(),
        },
      };
    },
  });
  console.log(JSON.stringify(result));
  if (["failed", "blocked"].includes(result.state)) process.exitCode = 1;
} finally {
  await queue.close();
}
