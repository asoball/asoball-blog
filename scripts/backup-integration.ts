import { backupLocal, restoreLocal } from "./backup-lib";
import { MongoClient } from "mongodb";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import path from "node:path";
const client = new MongoClient(
  "mongodb://127.0.0.1:27017/asoball_blog_test?replicaSet=rs0&directConnection=true",
);
await client.connect();
const run = randomUUID(),
  key = randomBytes(32),
  dataDir = path.resolve(".local/backup-test", run),
  destination = path.resolve(".local/restore-tests", run);
const source = client.db(),
  target = client.db("asoball_blog_restore");
let ownsRestore = false;
const importedIds = new Map<string, unknown[]>();
try {
  for (const item of await target
    .listCollections({}, { nameOnly: true })
    .toArray())
    if (await target.collection(item.name).findOne({}))
      throw new Error(
        "Restore test requires an empty dedicated restore database.",
      );
  await source
    .collection("backup_probes")
    .insertOne({ _id: run as never, value: "BACKUP_PRIVATE_CANARY" });
  await mkdir(path.join(dataDir, "media"), { recursive: true });
  await writeFile(
    path.join(dataDir, "media", "fixture.png"),
    "PRIVATE_MEDIA_CANARY",
  );
  for (const item of await source
    .listCollections({}, { nameOnly: true })
    .toArray())
    importedIds.set(
      item.name,
      (
        await source
          .collection(item.name)
          .find({}, { projection: { _id: 1 } })
          .toArray()
      ).map((doc) => doc._id),
    );
  const folder = await backupLocal({
    database: "asoball_blog_test",
    dataDir,
    offline: true,
    key,
  });
  const bytes = await readFile(path.join(folder, "database.enc"));
  assert.ok(!bytes.includes(Buffer.from("BACKUP_PRIVATE_CANARY")));
  await assert.rejects(
    restoreLocal({
      folder,
      destination: destination + "-bad-key",
      key: randomBytes(32),
    }),
  );
  assert.equal(
    await target
      .collection("backup_probes")
      .countDocuments({ _id: run as never }),
    0,
  );
  const restored = await restoreLocal({ folder, destination, key });
  ownsRestore = true;
  assert.equal(restored.mediaFiles, 1);
  assert.equal(
    (await target.collection("backup_probes").findOne({ _id: run as never }))
      ?.value,
    "BACKUP_PRIVATE_CANARY",
  );
  assert.equal(
    await readFile(path.join(destination, "media", "fixture.png"), "utf8"),
    "PRIVATE_MEDIA_CANARY",
  );
  await assert.rejects(
    restoreLocal({ folder, destination: destination + "-nonempty", key }),
  );
  console.log(
    "PASS backup: AES-GCM encrypted database/media, wrong-key rejection before restore, restored data/media, non-empty target refusal.",
  );
} finally {
  await source.collection("backup_probes").deleteOne({ _id: run as never });
  // Target was verified empty before this test; remove only the exact imported IDs.
  if (ownsRestore)
    for (const [name, ids] of importedIds)
      if (ids.length)
        await target
          .collection(name)
          .deleteMany({ _id: { $in: ids as never[] } });
  await client.close();
}
