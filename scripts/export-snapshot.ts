import { MongoClient } from "mongodb";
import path from "node:path";
import { exportSnapshot } from "@asoball/publishing/snapshot";
import { loadCmsEnvironment } from "../apps/cms/src/environment-file";
import { readEnvironment } from "../apps/cms/src/environment";
loadCmsEnvironment();
const env = readEnvironment(process.env);
const client = new MongoClient(env.DATABASE_URI, { maxPoolSize: 3 });
await client.connect();
try {
  const admin = await client
    .db()
    .collection("users")
    .findOne({ role: "admin" });
  if (!admin) throw new Error("Run pnpm bootstrap first.");
  const directory = path.resolve(
    ".local/snapshots",
    process.argv[2] || `manual-${Date.now()}`,
  );
  const snapshot = await exportSnapshot({
    uri: env.DATABASE_URI,
    actor: { id: String(admin._id), role: "admin" },
    directory,
    dataDir: path.resolve(process.env.LOCAL_DATA_DIR || ".local"),
    mediaDriver: env.MEDIA_STORAGE,
    bucket: env.GCS_BUCKET,
  });
  console.log(
    `Exported ${snapshot.posts.length} published posts to ${directory}`,
  );
} finally {
  await client.close();
}
