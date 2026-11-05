import { MongoClient, ObjectId, type Document } from "mongodb";
import { Storage } from "@google-cloud/storage";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  snapshotSchema,
  sortedPosts,
  taxonomySchema,
  nodeSchema,
  type ContentNode,
  type PublicPost,
  type Snapshot,
} from "@asoball/content-contract";

export type Actor = { id: string; role: "admin" };
export type ExportOptions = {
  uri: string;
  actor: Actor;
  directory: string;
  dataDir: string;
  mediaDriver?: "local" | "gcs";
  bucket?: string;
};
const idOf = (value: unknown): string =>
  value instanceof ObjectId
    ? value.toHexString()
    : typeof value === "object" && value !== null
      ? idOf((value as Document).id ?? (value as Document)._id)
      : String(value);
export function contentMediaIds(value: unknown, ids = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) contentMediaIds(item, ids);
  } else if (value && typeof value === "object") {
    const obj = value as Document;
    if (obj.type === "upload" && obj.relationTo === "media")
      ids.add(idOf(obj.value));
    for (const item of Object.values(obj)) contentMediaIds(item, ids);
  }
  return ids;
}
export async function exportSnapshot(
  options: ExportOptions,
): Promise<Snapshot> {
  if (options.actor.role !== "admin" || !ObjectId.isValid(options.actor.id))
    throw new Error("Authorized publishing actor required.");
  const snapshotFile = path.join(options.directory, "snapshot.json");
  const client = new MongoClient(options.uri, { maxPoolSize: 3 });
  await client.connect();
  try {
    const db = client.db();
    if (
      !(await db
        .collection("users")
        .findOne(
          { _id: new ObjectId(options.actor.id), role: "admin" },
          { projection: { _id: 1 } },
        ))
    )
      throw new Error("Publishing administrator is no longer authorized.");
    try {
      return snapshotSchema.parse(
        JSON.parse(await readFile(snapshotFile, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let rawPosts: Document[] = [],
      rawCategories: Document[] = [],
      rawTags: Document[] = [],
      rawMedia: Document[] = [];
    const session = client.startSession();
    try {
      await session.withTransaction(
        async () => {
          rawPosts = await db
            .collection("posts")
            .find(
              { _status: "published" },
              {
                session,
                projection: {
                  title: 1,
                  slug: 1,
                  excerpt: 1,
                  content: 1,
                  category: 1,
                  tags: 1,
                  coverImage: 1,
                  featured: 1,
                  publishedAt: 1,
                  updatedAt: 1,
                  seoTitle: 1,
                  seoDescription: 1,
                },
              },
            )
            .sort({ slug: 1 })
            .toArray();
          rawCategories = await db
            .collection("categories")
            .find(
              {},
              { session, projection: { name: 1, slug: 1, description: 1 } },
            )
            .sort({ slug: 1 })
            .toArray();
          rawTags = await db
            .collection("tags")
            .find(
              {},
              { session, projection: { name: 1, slug: 1, description: 1 } },
            )
            .sort({ slug: 1 })
            .toArray();
          const ids = new Set<string>();
          for (const post of rawPosts) {
            if (post.coverImage) ids.add(idOf(post.coverImage));
            contentMediaIds(post.content, ids);
          }
          rawMedia = ids.size
            ? await db
                .collection("media")
                .find(
                  { _id: { $in: [...ids].map((id) => new ObjectId(id)) } },
                  {
                    session,
                    projection: {
                      filename: 1,
                      mimeType: 1,
                      alt: 1,
                      width: 1,
                      height: 1,
                      prefix: 1,
                    },
                  },
                )
                .toArray()
            : [];
        },
        { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } },
      );
    } finally {
      await session.endSession();
    }
    const categories = new Map(
      rawCategories.map((doc) => [idOf(doc._id), taxonomySchema.parse(doc)]),
    );
    const tags = new Map(
      rawTags.map((doc) => [idOf(doc._id), taxonomySchema.parse(doc)]),
    );
    const images = new Map<
      string,
      { url: string; alt: string; width: number; height: number }
    >();
    const mediaBytes = new Map<string, Buffer>();
    for (const media of rawMedia) {
      const filename = String(media.filename);
      if (path.basename(filename) !== filename || filename.includes(".."))
        throw new Error("Unsafe media filename.");
      let original: Buffer;
      if (options.mediaDriver === "gcs") {
        if (!options.bucket)
          throw new Error("Private GCS media bucket is required.");
        const prefix = String(media.prefix || "");
        if (prefix.includes("..")) throw new Error("Unsafe media prefix.");
        [original] = await new Storage()
          .bucket(options.bucket)
          .file(path.posix.join(prefix, filename))
          .download();
      } else
        original = await readFile(
          path.join(options.dataDir, "media", filename),
        );
      const { data, info } = await sharp(original, {
        limitInputPixels: 40000000,
      })
        .resize({ width: 1600, withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      const hash = createHash("sha256").update(data).digest("hex");
      const name = `${hash}.webp`;
      mediaBytes.set(name, data);
      images.set(idOf(media._id), {
        url: `/media/${name}`,
        alt: String(media.alt),
        width: info.width,
        height: info.height,
      });
    }
    const publishedLinks = new Map(
      rawPosts.map((post) => [idOf(post._id), `/posts/${String(post.slug)}/`]),
    );
    function normalize(value: unknown, depth = 0): ContentNode {
      if (depth > 40 || !value || typeof value !== "object")
        throw new Error("Invalid Lexical tree.");
      const node = value as Document;
      if (node.type === "upload" && node.relationTo === "media") {
        const image = images.get(idOf(node.value));
        if (!image) throw new Error("Published image reference is missing.");
        return { type: "image", image };
      }
      const fields = node.fields ? { ...node.fields } : undefined;
      if (fields?.linkType === "internal")
        fields.url = publishedLinks.get(idOf(fields.doc?.value));
      return nodeSchema.parse({
        ...node,
        type:
          node.type === "tablecell" && node.headerState
            ? "tableheader"
            : node.type,
        fields,
        children: Array.isArray(node.children)
          ? node.children.map((child) => normalize(child, depth + 1))
          : undefined,
        // Raw relationship values are private; only normalized image nodes may carry them.
        value: typeof node.value === "number" ? node.value : undefined,
      });
    }
    const posts = rawPosts.map((post): PublicPost => {
      const category = post.category
        ? categories.get(idOf(post.category))
        : undefined;
      if (post.category && !category)
        throw new Error("Published category reference is missing.");
      const cover = post.coverImage
        ? images.get(idOf(post.coverImage))
        : undefined;
      if (post.coverImage && !cover)
        throw new Error("Published cover reference is missing.");
      const selectedTags = (post.tags ?? []).map((id: unknown) => {
        const tag = tags.get(idOf(id));
        if (!tag) throw new Error("Published tag reference is missing.");
        return tag;
      });
      return {
        id: idOf(post._id),
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt || "",
        content: { root: normalize(post.content.root) },
        category,
        tags: selectedTags,
        cover,
        publishedAt: new Date(post.publishedAt).toISOString(),
        updatedAt: new Date(post.updatedAt).toISOString(),
        featured: Boolean(post.featured),
        seo: {
          title: post.seoTitle || post.title,
          description: post.seoDescription || post.excerpt || "",
          canonicalPath: `/posts/${post.slug}/`,
        },
      };
    });
    const snapshot = snapshotSchema.parse({
      schemaVersion: 1,
      posts: sortedPosts(posts),
      categories: [...categories.values()],
      tags: [...tags.values()],
    });
    await mkdir(path.join(options.directory, "media"), { recursive: true });
    for (const [filename, data] of mediaBytes) {
      try {
        await writeFile(path.join(options.directory, "media", filename), data, {
          flag: "wx",
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    await writeFile(snapshotFile, JSON.stringify(snapshot, null, 2), {
      flag: "wx",
    });
    return snapshot;
  } finally {
    await client.close();
  }
}
