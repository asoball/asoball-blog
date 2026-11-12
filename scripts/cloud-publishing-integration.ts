import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { PublisherQueue, jobs, states } from "@asoball/publishing/queue";
import { exportSnapshot } from "@asoball/publishing/snapshot";
import {
  runCloudOnce,
  reconcileCloud,
  type CloudWorkerOptions,
} from "../packages/publishing/src/cloud-worker";
import {
  stageFirebaseVersion,
  releaseFirebaseVersion,
  type ApiTransport,
} from "../packages/publishing/src/firebase";
import { sha256 } from "../packages/publishing/src/cloud-artifacts";
import { buildBlog } from "./build-blog";

// Dedicated local Docker DB only. Cloud APIs below are in-memory contract doubles.
process.env.DATABASE_URI =
  "mongodb://127.0.0.1:27017/asoball_blog_test?replicaSet=rs0&directConnection=true";
process.env.PAYLOAD_SECRET = "cloud-integration-test-secret-not-for-production";
process.env.PUBLISHING_ENABLED = "true";
process.env.MEDIA_STORAGE = "local";
process.env.DEPLOYMENT_ENV = "local";
const { getPayload } = await import("payload");
const { default: config } = await import("../apps/cms/src/payload.config");
const payload = await getPayload({ config });
const queue = await new PublisherQueue(process.env.DATABASE_URI).open();
const run = randomUUID(),
  root = path.resolve(".local/cloud-integration", run);
const user = await payload.create({
  collection: "users",
  overrideAccess: true,
  context: { bootstrap: true },
  data: {
    email: `cloud-${run}@example.invalid`,
    password: randomUUID(),
    role: "admin",
  },
});
const actor = { id: String(user.id), role: "admin" as const };
const content = (text: string) => ({
  root: {
    type: "root",
    version: 1,
    direction: null,
    format: "" as const,
    indent: 0,
    children: [
      {
        type: "paragraph",
        version: 1,
        children: [
          {
            type: "text",
            version: 1,
            text,
            format: 0,
            detail: 0,
            mode: "normal",
            style: "",
          },
        ],
        direction: null,
        format: "" as const,
        indent: 0,
      },
    ],
  },
});
let postId: string | undefined, draftId: string | undefined;
let versionCounter = 0,
  releaseCounter = 0;
let current: Awaited<ReturnType<CloudWorkerOptions["latest"]>>;
let uploaded = new Map<string, string>();
const transport: ApiTransport = {
  request: async (request) => {
    if (request.url.endsWith("/versions")) {
      uploaded = new Map();
      return {
        data: { name: `sites/test-site/versions/v${++versionCounter}` },
      };
    }
    if (request.url.endsWith(":populateFiles"))
      return {
        data: {
          uploadUrl: `https://upload-firebasehosting.googleapis.com/upload/sites/test-site/versions/v${versionCounter}/files`,
          uploadRequiredHashes: Object.values(
            (request.data as { files: Record<string, string> }).files,
          ),
        },
      };
    if (request.url.includes("upload-firebasehosting")) {
      uploaded.set(
        request.url.split("/").at(-1)!,
        gunzipSync(request.data as Buffer).toString(),
      );
      return { data: {} };
    }
    if (request.method === "PATCH")
      return {
        data: {
          name: `sites/test-site/versions/v${versionCounter}`,
          status: "FINALIZED",
        },
      };
    if (request.url.includes("/releases?")) {
      current = {
        name: `sites/test-site/releases/r${++releaseCounter}`,
        message: (request.data as { message: string }).message,
        version: {
          name: new URL(request.url).searchParams.get("versionName")!,
        },
      };
      return { data: current };
    }
    throw new Error("Unexpected test API.");
  },
};
const prepare: CloudWorkerOptions["prepare"] = async (job, fence) => {
  const releaseId = `release-${String(job.seq).padStart(10, "0")}-f${fence}`;
  const directory = path.join(root, releaseId),
    snapshotFile = path.join(directory, "snapshot.json"),
    siteDir = path.join(directory, "site");
  await exportSnapshot({
    uri: process.env.DATABASE_URI!,
    actor: job.actor,
    directory,
    dataDir: root,
    mediaDriver: "local",
  });
  const snapshot = await readFile(snapshotFile);
  assert.ok(!snapshot.toString().includes(`draft-secret-${run}`));
  await buildBlog({ snapshotFile, siteDir });
  const version = await stageFirebaseVersion(
    "test-site",
    siteDir,
    {},
    transport,
  );
  return {
    version,
    active: {
      releaseId,
      seq: job.seq,
      sourceDigest: "a".repeat(40),
      snapshotDigest: sha256(snapshot),
      activatedAt: new Date().toISOString(),
    },
  };
};
const fastPrepare: CloudWorkerOptions["prepare"] = async (job, fence) => ({
  version: "sites/test-site/versions/fast",
  active: {
    releaseId: `release-${String(job.seq).padStart(10, "0")}-f${fence}`,
    seq: job.seq,
    sourceDigest: "a".repeat(40),
    snapshotDigest: "b".repeat(64),
    activatedAt: new Date().toISOString(),
  },
});
const options: CloudWorkerOptions = {
  site: "test-site",
  prepare,
  latest: async () => current,
  publish: (version, message) =>
    releaseFirebaseVersion("test-site", version, message, transport),
};
try {
  const post = await payload.create({
    collection: "posts",
    user,
    overrideAccess: false,
    data: {
      title: `Cloud article ${run}`,
      slug: `cloud-${run}`,
      content: content("initial-public-body"),
      _status: "published",
    },
  });
  postId = String(post.id);
  const beforeDraft = (await states(queue.db).findOne({ _id: "state" }))!
    .desired;
  const draft = await payload.create({
    collection: "posts",
    user,
    overrideAccess: false,
    draft: true,
    data: {
      title: `draft-secret-${run}`,
      slug: `draft-${run}`,
      content: content(`draft-secret-${run}`),
    },
  });
  draftId = String(draft.id);
  assert.equal(
    (await states(queue.db).findOne({ _id: "state" }))!.desired,
    beforeDraft,
  );
  assert.equal((await runCloudOnce(queue, options)).state, "succeeded");
  assert.ok(
    [...uploaded.values()].some((html) => html.includes("initial-public-body")),
  );
  await payload.update({
    collection: "posts",
    id: postId,
    user,
    overrideAccess: false,
    data: { content: content("updated-public-body"), _status: "published" },
  });
  assert.equal((await runCloudOnce(queue, options)).state, "succeeded");
  assert.ok(
    [...uploaded.values()].some((html) => html.includes("updated-public-body")),
  );
  await payload.update({
    collection: "posts",
    id: postId,
    user,
    overrideAccess: false,
    data: { _status: "draft" },
  });
  assert.equal((await runCloudOnce(queue, options)).state, "succeeded");
  assert.ok(
    ![...uploaded.values()].some((html) =>
      html.includes("updated-public-body"),
    ),
  );
  await payload.update({
    collection: "posts",
    id: postId,
    user,
    overrideAccess: false,
    data: { _status: "published" },
  });
  await payload.delete({
    collection: "posts",
    id: postId,
    user,
    overrideAccess: false,
  });
  postId = undefined;
  assert.equal((await runCloudOnce(queue, options)).state, "succeeded");
  assert.ok(
    ![...uploaded.values()].some((html) =>
      html.includes("updated-public-body"),
    ),
  );
  let priorRelease = current;
  await queue.request(actor, `cloud-${run}-failure`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal(
      (
        await runCloudOnce(queue, {
          ...options,
          prepare: async () => {
            throw new Error("build failure");
          },
        })
      ).state,
      "failed",
    );
    await jobs(queue.db).updateMany(
      { "actor.id": actor.id, state: "queued" },
      { $set: { availableAt: new Date(0) } },
    );
  }
  assert.deepEqual(current, priorRelease);
  const contender = await new PublisherQueue(process.env.DATABASE_URI!).open();
  try {
    await queue.request(actor, `cloud-${run}-concurrent`);
    assert.equal(
      (
        await runCloudOnce(queue, {
          ...options,
          prepare: async (job, fence, checkpoint) => {
            assert.equal(
              (
                await runCloudOnce(contender, {
                  ...options,
                  prepare: fastPrepare,
                })
              ).state,
              "busy",
            );
            return fastPrepare(job, fence, checkpoint);
          },
        })
      ).state,
      "succeeded",
    );
    await queue.request(actor, `cloud-${run}-lease-lost`);
    let successorFence: number | undefined;
    assert.equal(
      (
        await runCloudOnce(queue, {
          ...options,
          prepare: async (job, fence, checkpoint) => {
            await states(queue.db).updateOne(
              { _id: "state", fence },
              { $set: { "lock.expiresAt": new Date(0) } },
            );
            successorFence = (await contender.acquire())!.fence;
            return fastPrepare(job, fence, checkpoint);
          },
        })
      ).state,
      "failed",
    );
    assert.ok(successorFence);
    await contender.release(successorFence);
  } finally {
    await contender.close();
  }
  priorRelease = current;
  assert.equal(
    (await jobs(queue.db).findOne({ key: `cloud-${run}-failure` }))!.state,
    "failed",
  );
  await queue.request(actor, `cloud-${run}-stale`);
  assert.equal(
    (
      await runCloudOnce(queue, {
        ...options,
        prepare: async (job, fence, checkpoint) => {
          await queue.request(actor, `cloud-${run}-newer`);
          return fastPrepare(job, fence, checkpoint);
        },
      })
    ).state,
    "superseded",
  );
  assert.deepEqual(current, priorRelease);
  assert.equal(
    (await runCloudOnce(queue, { ...options, prepare: fastPrepare })).state,
    "succeeded",
  );
  await queue.request(actor, `cloud-${run}-timeout`);
  assert.equal(
    (
      await runCloudOnce(queue, {
        ...options,
        prepare: fastPrepare,
        publish: async (version, message) => {
          await options.publish(version, message);
          assert.equal(await reconcileCloud(queue, options), "busy");
          throw new Error("response lost after activation");
        },
      })
    ).state,
    "blocked",
  );
  assert.equal(await reconcileCloud(queue, options), "reconciled");
  assert.equal(
    (await jobs(queue.db).findOne({ key: `cloud-${run}-timeout` }))!.state,
    "succeeded",
  );
  await queue.request(actor, `cloud-${run}-unknown`);
  assert.equal(
    (
      await runCloudOnce(queue, {
        ...options,
        prepare: fastPrepare,
        publish: async () => {
          throw new Error("unknown outcome");
        },
      })
    ).state,
    "blocked",
  );
  assert.equal((await runCloudOnce(queue, options)).state, "blocked");
  assert.equal(await queue.acquire(), null);
  // Test teardown resolves ONLY this test's permit after its fake request is known finished.
  await states(queue.db).updateOne(
    { _id: "state", "cloudPending.owner": queue.owner },
    { $unset: { cloudPending: "" } },
  );
  console.log(
    "PASS: cloud outbox publish/update/unpublish/delete + real Astro + gzip Hosting contract; draft isolation, retries, stale rejection, ambiguous activation reconciliation and fail-closed.",
  );
} finally {
  if (postId)
    await payload.delete({
      collection: "posts",
      id: postId,
      user,
      overrideAccess: false,
    });
  if (draftId)
    await payload.delete({
      collection: "posts",
      id: draftId,
      user,
      overrideAccess: false,
    });
  await jobs(queue.db).deleteMany({ "actor.id": actor.id });
  await payload.delete({
    collection: "users",
    id: user.id,
    overrideAccess: true,
  });
  await queue.close();
  await payload.destroy();
}
process.exit(0);
