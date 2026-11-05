import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { exportSnapshot } from "@asoball/publishing/snapshot";
process.env.DATABASE_URI =
  "mongodb://127.0.0.1:27017/asoball_blog_test?replicaSet=rs0&directConnection=true";
process.env.PAYLOAD_SECRET = randomBytes(48).toString("hex");
process.env.PUBLISHING_ENABLED = "false";
process.env.LOCAL_DATA_DIR = path.resolve(".local/integration");
const { getPayload } = await import("payload");
const { default: config } = await import("../apps/cms/src/payload.config");
const payload = await getPayload({ config });
const run = randomUUID();
const docs: {
  collection: "users" | "posts" | "categories" | "tags" | "media";
  id: number | string;
}[] = [];
const content = {
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
        direction: null,
        format: "",
        indent: 0,
        children: [
          {
            type: "text",
            text: "Integration fixture",
            format: 0,
            detail: 0,
            mode: "normal",
            style: "",
            version: 1,
          },
        ],
      },
    ],
  },
};
try {
  const password = randomBytes(32).toString("hex");
  const user = await payload.create({
    collection: "users",
    overrideAccess: true,
    context: { bootstrap: true },
    data: { email: `${run}@example.invalid`, password, role: "admin" },
  });
  docs.push({ collection: "users", id: user.id });
  assert.ok(
    (
      await payload.login({
        collection: "users",
        data: { email: user.email, password },
      })
    ).token,
  );
  const cat = await payload.create({
    collection: "categories",
    user,
    overrideAccess: false,
    data: { name: "Integration fixture", slug: `cat-${run}` },
  });
  docs.push({ collection: "categories", id: cat.id });
  const tag = await payload.create({
    collection: "tags",
    user,
    overrideAccess: false,
    data: { name: "Integration fixture", slug: `tag-${run}` },
  });
  docs.push({ collection: "tags", id: tag.id });
  const imageBytes = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "#1D4ED8" },
  })
    .png()
    .toBuffer();
  const media = await payload.create({
    collection: "media",
    user,
    overrideAccess: false,
    data: { alt: "Snapshot integration fixture" },
    file: {
      data: imageBytes,
      name: "fixture.png",
      mimetype: "image/png",
      size: imageBytes.length,
    },
  });
  docs.push({ collection: "media", id: media.id });
  const post = await payload.create({
    collection: "posts",
    user,
    overrideAccess: false,
    draft: true,
    data: {
      title: "Integration fixture",
      slug: `post-${run}`,
      category: cat.id,
      tags: [tag.id],
      content,
      coverImage: media.id,
    },
  });
  docs.push({ collection: "posts", id: post.id });
  assert.equal(
    (
      await payload.find({
        collection: "posts",
        overrideAccess: false,
        where: { id: { equals: post.id } },
      })
    ).totalDocs,
    0,
  );
  await assert.rejects(
    payload.delete({
      collection: "categories",
      id: cat.id,
      user,
      overrideAccess: false,
    }),
  );
  await payload.update({
    collection: "posts",
    id: post.id,
    user,
    overrideAccess: false,
    data: { _status: "published" },
  });
  const publicRead = await payload.findByID({
    collection: "posts",
    id: post.id,
    overrideAccess: false,
  });
  assert.equal(publicRead.slug, post.slug);
  assert.equal(publicRead.content, undefined);
  const draft = await payload.create({
    collection: "posts",
    user,
    overrideAccess: false,
    draft: true,
    data: { title: "DRAFT_CANARY_SNAPSHOT", slug: `draft-${run}`, content },
  });
  docs.push({ collection: "posts", id: draft.id });
  const directory = path.resolve(".local/snapshot-tests", run);
  const options = {
    uri: process.env.DATABASE_URI!,
    actor: { id: String(user.id), role: "admin" as const },
    directory,
    dataDir: process.env.LOCAL_DATA_DIR!,
  };
  const snapshot = await exportSnapshot(options);
  assert.ok(snapshot.posts.some((item) => item.id === post.id));
  assert.ok(!snapshot.posts.some((item) => item.id === draft.id));
  const snapshotBytes = await readFile(
    path.join(directory, "snapshot.json"),
    "utf8",
  );
  assert.doesNotMatch(
    snapshotBytes,
    /DRAFT_CANARY|"users"|"versions"|"_status"|password|filename/,
  );
  const image = snapshot.posts.find((item) => item.id === post.id)?.cover;
  assert.ok(image);
  assert.match(image.url, /^\/media\/[a-f0-9]{64}\.webp$/);
  assert.equal(
    (await sharp(await readFile(path.join(directory, image.url))).metadata())
      .format,
    "webp",
  );
  await exportSnapshot(options);
  assert.equal(
    await readFile(path.join(directory, "snapshot.json"), "utf8"),
    snapshotBytes,
  );
  console.log(
    "PASS snapshot: published-only DTO, private fields stripped, optimized referenced media, immutable repeat export.",
  );
  await assert.rejects(
    payload.create({
      collection: "posts",
      user,
      overrideAccess: false,
      data: { title: "Duplicate", slug: post.slug, content },
    }),
  );
  await assert.rejects(
    payload.update({
      collection: "posts",
      id: post.id,
      user,
      overrideAccess: false,
      data: { slug: "changed-slug" },
    }),
  );
  const indexes = await payload.db.collections.posts.collection.indexes();
  assert.ok(indexes.some((index) => index.key.slug === 1 && index.unique));
  const versions = await payload.findVersions({
    collection: "posts",
    user,
    overrideAccess: false,
    where: { parent: { equals: post.id } },
  });
  assert.ok(versions.totalDocs >= 2);
  await payload.restoreVersion({
    collection: "posts",
    id: versions.docs[versions.docs.length - 1].id,
    user,
    overrideAccess: false,
  });
  for (const collection of ["users", "media"] as const)
    await assert.rejects(payload.find({ collection, overrideAccess: false }));
  await assert.rejects(
    payload.findVersions({ collection: "posts", overrideAccess: false }),
  );
  await assert.rejects(
    payload.create({
      collection: "categories",
      overrideAccess: false,
      data: { name: "Denied", slug: `denied-${run}` },
    }),
  );
  await assert.rejects(
    payload.create({
      collection: "users",
      overrideAccess: true,
      data: { email: `denied-${run}@example.invalid`, password, role: "admin" },
    }),
  );
  await payload.update({
    collection: "posts",
    id: post.id,
    user,
    overrideAccess: false,
    data: { _status: "draft" },
  });
  assert.equal(
    (
      await payload.find({
        collection: "posts",
        overrideAccess: false,
        where: { id: { equals: post.id } },
      })
    ).totalDocs,
    0,
  );
  console.log(
    "PASS CMS: login, CRUD, relations, delete protection, unique index, immutable slug, version restore, publish/unpublish and ACL.",
  );
} finally {
  try {
    for (const doc of docs.reverse())
      await payload.delete({ ...doc, overrideAccess: true });
  } finally {
    await payload.destroy();
    console.log("CMS cleanup and database disconnect complete.");
  }
}
process.exit(0);
