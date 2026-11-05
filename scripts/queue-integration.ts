import { PublisherQueue, jobs, states } from "@asoball/publishing/queue";
import { randomUUID } from "node:crypto";
import { getPayload } from "payload";
import { reconcilePointer } from "@asoball/publishing/worker";
import path from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
process.env.DATABASE_URI =
  "mongodb://127.0.0.1:27017/asoball_blog_test?replicaSet=rs0&directConnection=true";
process.env.PUBLISHING_ENABLED = "false";
process.env.PAYLOAD_SECRET = "queue-integration-random-fixture-secret";
const { default: config } = await import("../apps/cms/src/payload.config");
const payload = await getPayload({ config });
const q1 = await new PublisherQueue(process.env.DATABASE_URI).open(),
  q2 = await new PublisherQueue(process.env.DATABASE_URI).open();
const run = randomUUID();
let userId: string | undefined;
try {
  const user = await payload.create({
    collection: "users",
    overrideAccess: true,
    context: { bootstrap: true },
    data: {
      email: `queue-${run}@example.invalid`,
      password: randomUUID(),
      role: "admin",
    },
  });
  userId = String(user.id);
  const actor = { id: String(user.id), role: "admin" as const };
  const keys = [`queue-${run}-a`, `queue-${run}-b`];
  const duplicate = await Promise.all([
    q1.request(actor, keys[0]),
    q2.request(actor, keys[0]),
  ]);
  assert.equal(duplicate[0]!.seq, duplicate[1]!.seq);
  const newer = await q2.request(actor, keys[1]);
  assert.ok(newer!.seq > duplicate[0]!.seq);
  const locks = await Promise.all([q1.acquire(), q2.acquire()]);
  assert.equal(locks.filter(Boolean).length, 1);
  const winner = locks[0] ? q1 : q2;
  const loser = winner === q1 ? q2 : q1;
  const lock = locks.find(Boolean)!;
  assert.deepEqual(
    await reconcilePointer(loser, path.resolve(".local/queue-busy-test")),
    { state: "busy" },
  );
  assert.equal(await winner.owned(lock.fence), true);
  const contender = await new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "scripts/publisher.ts", "--once"],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        output += String(chunk);
      });
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, output }));
    },
  );
  assert.equal(contender.code, 0, contender.output);
  assert.match(contender.output, /"state":"busy"/);
  assert.equal(await winner.owned(lock.fence), true);
  const job = await winner.claim(lock.fence);
  assert.equal(job!.seq, newer!.seq);
  assert.equal(
    await winner.activate(
      {
        releaseId: "release-test",
        seq: duplicate[0]!.seq,
        sourceDigest: "x",
        snapshotDigest: "y",
        activatedAt: new Date().toISOString(),
      },
      lock.fence,
    ),
    false,
  );
  await states(winner.db).updateOne(
    { _id: "state", "lock.owner": winner.owner },
    { $set: { "lock.expiresAt": new Date(0) } },
  );
  const reclaimed = await loser.acquire();
  assert.ok(reclaimed);
  assert.ok(reclaimed.fence > lock.fence);
  assert.equal(await winner.heartbeat(lock.fence), false);
  assert.equal(await winner.owned(lock.fence), false);
  const resumed = await loser.claim(reclaimed.fence);
  assert.equal(resumed!._id.toString(), job!._id.toString());
  await loser.fail(resumed!, reclaimed.fence);
  assert.equal(
    (await jobs(loser.db).findOne({ _id: job!._id }))?.state,
    "queued",
  );
  await loser.release(reclaimed.fence);
  await jobs(q1.db).updateOne(
    { _id: job!._id },
    { $set: { state: "running", attempts: 3 } },
  );
  const exhausted = await q1.acquire();
  assert.ok(exhausted);
  assert.equal(await q1.claim(exhausted.fence), null);
  assert.equal((await jobs(q1.db).findOne({ _id: job!._id }))?.state, "failed");
  await q1.release(exhausted.fence);
  console.log(
    "PASS queue: dedupe, monotonic order, coalescing, single worker, stale fence rejection, crash resume and retry.",
  );
} finally {
  await jobs(q1.db).deleteMany({ key: { $regex: `^queue-${run}-` } });
  if (userId)
    await payload.delete({
      collection: "users",
      id: userId,
      overrideAccess: true,
    });
  await q1.close();
  await q2.close();
  await payload.destroy();
}
process.exit(0);
