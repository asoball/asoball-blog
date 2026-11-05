import assert from "node:assert/strict";
import { readFile, stat, unlink } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { PublisherQueue, jobs } from "@asoball/publishing/queue";
import { runOnce, reconcilePointer } from "@asoball/publishing/worker";
import { rollback } from "../packages/publishing/src/rollback";
import { buildBlog } from "./build-blog";
process.env.DATABASE_URI =
  "mongodb://127.0.0.1:27017/asoball_blog_test?replicaSet=rs0&directConnection=true";
process.env.PAYLOAD_SECRET = randomBytes(48).toString("hex");
process.env.PUBLISHING_ENABLED = "true";
process.env.LOCAL_DATA_DIR = path.resolve(".local/publishing-test");
const { getPayload } = await import("payload");
const { default: config } = await import("../apps/cms/src/payload.config");
const testConfig = await config;
let mutationEntered = () => {};
testConfig.collections
  ?.find((collection) => collection.slug === "posts")
  ?.hooks?.beforeChange?.push(async ({ data, req }) => {
    if (req.context.testHeartbeatRace) {
      mutationEntered();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return data;
  });
testConfig.collections
  ?.find((collection) => collection.slug === "posts")
  ?.hooks?.afterChange?.push(({ doc, req }) => {
    if (req.context.testRollback)
      throw new Error("Injected transaction abort after outbox append.");
    return doc;
  });
const payload = await getPayload({ config: testConfig });
const queue = await new PublisherQueue(process.env.DATABASE_URI).open();
const run = randomUUID();
const cleanup: {
  collection: "users" | "posts" | "categories" | "tags" | "media";
  id: string | number;
}[] = [];
const options = {
  uri: process.env.DATABASE_URI!,
  dataDir: process.env.LOCAL_DATA_DIR!,
  repoRoot: process.cwd(),
  build: buildBlog,
};
const pointer = () =>
  readFile(path.join(options.dataDir, "active.json"), "utf8");
const root = {
  type: "root",
  version: 1,
  direction: null,
  format: "" as const,
  indent: 0,
  children: [
    {
      type: "paragraph",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: [
        {
          type: "text",
          text: "Published pipeline fixture",
          format: 0,
          detail: 0,
          mode: "normal",
          style: "",
          version: 1,
        },
      ],
    },
  ],
};
let actorId: string | undefined;
try {
  const user = await payload.create({
    collection: "users",
    overrideAccess: true,
    context: { bootstrap: true },
    data: {
      email: `publisher-${run}@example.invalid`,
      password: randomUUID(),
      role: "admin",
    },
  });
  actorId = String(user.id);
  cleanup.push({ collection: "users", id: user.id });
  await assert.rejects(
    payload.create({
      collection: "categories",
      user,
      overrideAccess: false,
      disableTransaction: true,
      data: { name: "Must not persist", slug: `disabled-${run}` },
    }),
  );
  assert.equal(
    (
      await payload.find({
        collection: "categories",
        user,
        overrideAccess: false,
        where: { slug: { equals: `disabled-${run}` } },
      })
    ).totalDocs,
    0,
  );
  const category = await payload.create({
    collection: "categories",
    user,
    overrideAccess: false,
    data: { name: "Pipeline fixture", slug: `pipeline-${run}` },
  });
  cleanup.push({ collection: "categories", id: category.id });
  const bytes = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "#1D4ED8" },
  })
    .png()
    .toBuffer();
  const media = await payload.create({
    collection: "media",
    user,
    overrideAccess: false,
    data: { alt: "Published pipeline image" },
    file: {
      name: "pipeline.png",
      data: bytes,
      mimetype: "image/png",
      size: bytes.length,
    },
  });
  cleanup.push({ collection: "media", id: media.id });
  const beforeDraft = await jobs(queue.db).countDocuments({
    "actor.id": actorId,
  });
  const post = await payload.create({
    collection: "posts",
    user,
    overrideAccess: false,
    draft: true,
    data: {
      title: "Pipeline fixture",
      slug: `pipeline-${run}`,
      excerpt: "Published pipeline integration fixture.",
      content: { root },
      category: category.id,
      coverImage: media.id,
    },
  });
  cleanup.push({ collection: "posts", id: post.id });
  await payload.update({
    collection: "posts",
    id: post.id,
    user,
    overrideAccess: false,
    draft: true,
    data: { title: "Pipeline draft edited" },
  });
  assert.equal(
    await jobs(queue.db).countDocuments({ "actor.id": actorId }),
    beforeDraft,
  );
  const raceLease = await queue.acquire();
  assert.ok(raceLease);
  const entered = new Promise<void>((resolve) => {
    mutationEntered = resolve;
  });
  const publishing = payload.update({
    collection: "posts",
    id: post.id,
    user,
    overrideAccess: false,
    context: { testHeartbeatRace: true },
    data: { _status: "published" },
  });
  await entered;
  const [, heartbeat] = await Promise.all([
    publishing,
    queue.heartbeat(raceLease.fence),
  ]);
  assert.equal(heartbeat, true);
  await queue.release(raceLease.fence);
  const count = await jobs(queue.db).countDocuments({ "actor.id": actorId });
  await assert.rejects(
    payload.update({
      collection: "posts",
      id: post.id,
      user,
      overrideAccess: false,
      context: { testRollback: true },
      data: { title: "MUST_ROLL_BACK" },
    }),
  );
  assert.equal(
    await jobs(queue.db).countDocuments({ "actor.id": actorId }),
    count,
  );
  assert.notEqual(
    (
      await payload.findByID({
        collection: "posts",
        id: post.id,
        user,
        overrideAccess: false,
      })
    ).title,
    "MUST_ROLL_BACK",
  );
  const first = await runOnce(queue, options);
  assert.equal(first.state, "succeeded");
  const firstPointer = await pointer();
  await unlink(path.join(options.dataDir, "active.json"));
  assert.deepEqual(await reconcilePointer(queue, options.dataDir), {
    state: "reconciled",
  });
  assert.deepEqual(JSON.parse(await pointer()), JSON.parse(firstPointer));
  const active = JSON.parse(firstPointer) as { releaseId: string };
  const html = await readFile(
    path.join(
      options.dataDir,
      "releases",
      active.releaseId,
      "site",
      "posts",
      post.slug,
      "index.html",
    ),
    "utf8",
  );
  assert.match(html, /Pipeline draft edited/);
  await payload.update({
    collection: "posts",
    id: post.id,
    user,
    overrideAccess: false,
    data: { title: "Pipeline updated" },
  });
  const failed = await runOnce(queue, {
    ...options,
    build: async () => {
      throw new Error("Injected build failure.");
    },
  });
  assert.equal(failed.state, "failed");
  assert.equal(await pointer(), firstPointer);
  await jobs(queue.db).updateOne(
    { seq: failed.seq },
    { $set: { availableAt: new Date(0) } },
  );
  assert.equal((await runOnce(queue, options)).state, "succeeded");
  const beforeStale = await pointer();
  await payload.update({
    collection: "posts",
    id: post.id,
    user,
    overrideAccess: false,
    data: { title: "Pipeline older build" },
  });
  const stale = await runOnce(queue, {
    ...options,
    build: async (value) => {
      await buildBlog(value);
      await payload.update({
        collection: "posts",
        id: post.id,
        user,
        overrideAccess: false,
        data: { title: "Pipeline newest build" },
      });
    },
  });
  assert.equal(stale.state, "superseded");
  assert.equal(await pointer(), beforeStale);
  assert.equal((await runOnce(queue, options)).state, "succeeded");
  await payload.update({
    collection: "posts",
    id: post.id,
    user,
    overrideAccess: false,
    data: { _status: "draft" },
  });
  assert.equal((await runOnce(queue, options)).state, "succeeded");
  const unpublished = JSON.parse(await pointer()) as { releaseId: string };
  const site = path.join(
    options.dataDir,
    "releases",
    unpublished.releaseId,
    "site",
  );
  await assert.rejects(stat(path.join(site, "posts", post.slug, "index.html")));
  for (const file of ["rss.xml", "sitemap-0.xml", "index.html"])
    assert.ok(
      !(await readFile(path.join(site, file), "utf8")).includes(
        `/posts/${post.slug}/`,
      ),
    );
  await payload.update({
    collection: "posts",
    id: post.id,
    user,
    overrideAccess: false,
    data: { _status: "published" },
  });
  assert.equal((await runOnce(queue, options)).state, "succeeded");
  await payload.delete({
    collection: "posts",
    id: post.id,
    user,
    overrideAccess: false,
  });
  cleanup.pop();
  assert.equal((await runOnce(queue, options)).state, "succeeded");
  const deleted = JSON.parse(await pointer()) as { releaseId: string };
  await assert.rejects(
    stat(
      path.join(
        options.dataDir,
        "releases",
        deleted.releaseId,
        "site",
        "posts",
        post.slug,
        "index.html",
      ),
    ),
  );
  const rolledBack = await rollback(queue, options.dataDir, active.releaseId, {
    id: actorId,
    role: "admin",
  });
  assert.equal(rolledBack.releaseId, active.releaseId);
  assert.ok(rolledBack.seq > (first.seq ?? 0));
  const rollbackPointer = await pointer();
  const targetFile = path.join(
    options.dataDir,
    "releases",
    active.releaseId,
    "site",
    "index.html",
  );
  const original = await readFile(targetFile);
  await (
    await import("node:fs/promises")
  ).writeFile(targetFile, "FAULT_INJECTION");
  try {
    await assert.rejects(
      rollback(queue, options.dataDir, active.releaseId, {
        id: actorId,
        role: "admin",
      }),
    );
    assert.equal(await pointer(), rollbackPointer);
  } finally {
    await (await import("node:fs/promises")).writeFile(targetFile, original);
  }
  const lease = await queue.acquire();
  assert.ok(lease);
  const state = await (
    await import("@asoball/publishing/queue")
  )
    .states(queue.db)
    .findOne({ _id: "state" });
  assert.ok(state);
  const permit = queue.cloudPermit(state.desired, lease.fence);
  assert.equal(await permit.begin(), true);
  await queue.release(lease.fence);
  assert.equal(await queue.acquire(), null);
  await permit.complete({ name: "local-contract-test-no-cloud-request" });
  const nextLease = await queue.acquire();
  assert.ok(nextLease);
  await queue.release(nextLease.fence);
  console.log(
    "PASS rollback: integrity checks, atomic reactivation, corrupt release rejection, uncertain-cloud-activation successor blocking.",
  );
  console.log(
    "PASS publishing: transactional outbox rollback, draft suppression, real Astro publish/update/unpublish/delete, failed-build retention/retry, stale-build rejection.",
  );
} finally {
  process.env.PUBLISHING_ENABLED = "false";
  try {
    for (const doc of cleanup.reverse())
      await payload.delete({ ...doc, overrideAccess: true });
    if (actorId) await jobs(queue.db).deleteMany({ "actor.id": actorId });
  } finally {
    await queue.close();
    await payload.destroy();
  }
}
process.exit(0);
