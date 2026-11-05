import { Storage } from "@google-cloud/storage";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { snapshotSchema, type ContentNode } from "@asoball/content-contract";
import { buildBlog } from "./build-blog";
if (process.env.ALLOW_CLOUD_BUILD !== "true")
  throw new Error("Cloud build is disabled during local development.");
const source = process.env._SOURCE_SHA,
  commit = process.env.COMMIT_SHA;
if (!source || source !== commit || !/^[a-f0-9]{40}$/.test(source))
  throw new Error(
    "Cloud Build source commit does not match the immutable plan.",
  );
const uri = process.env._SNAPSHOT_URI || "",
  digest = process.env._SNAPSHOT_SHA256 || "";
const match = /^gs:\/\/([a-z0-9._-]+)\/([-a-zA-Z0-9_/]+)\/snapshot\.json$/.exec(
  uri,
);
if (!match || !/^[a-f0-9]{64}$/.test(digest))
  throw new Error("Invalid snapshot reference.");
const storage = new Storage(),
  directory = path.resolve(".local/cloud-candidate"),
  snapshotFile = path.join(directory, "snapshot.json");
await mkdir(path.join(directory, "media"), { recursive: true });
const [bytes] = await storage
  .bucket(match[1])
  .file(`${match[2]}/snapshot.json`)
  .download();
if (createHash("sha256").update(bytes).digest("hex") !== digest)
  throw new Error("Snapshot checksum mismatch.");
const snapshot = snapshotSchema.parse(JSON.parse(bytes.toString("utf8")));
await writeFile(snapshotFile, bytes, { flag: "wx" });
const images = new Set<string>();
const collect = (node: ContentNode) => {
  if (node.image) images.add(node.image.url);
  node.children?.forEach(collect);
};
for (const post of snapshot.posts) {
  if (post.cover) images.add(post.cover.url);
  collect(post.content.root);
}
for (const url of images) {
  const media = /^\/media\/([a-f0-9]{64})\.webp$/.exec(url);
  if (!media)
    throw new Error("Snapshot media must be a content-addressed object.");
  const [data] = await storage
    .bucket(match[1])
    .file(`${match[2]}/media/${media[1]}.webp`)
    .download();
  if (createHash("sha256").update(data).digest("hex") !== media[1])
    throw new Error("Media checksum mismatch.");
  await writeFile(path.join(directory, url), data, { flag: "wx" });
}
await buildBlog({ snapshotFile, siteDir: path.join(directory, "site") });
await writeFile(
  path.join(directory, "candidate.json"),
  JSON.stringify({
    commit,
    sourceSnapshotDigest: digest,
    releaseId: process.env._RELEASE_ID,
  }),
);
console.log(
  "Cloud candidate built and checked. Hosting activation is a separate fenced operation.",
);
