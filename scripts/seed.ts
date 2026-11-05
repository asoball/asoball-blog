import { readFile } from "node:fs/promises";
import sharp from "sharp";
import {
  fixtureSnapshot,
  draftFixtures,
} from "@asoball/content-contract/fixture";
import type { ContentNode } from "@asoball/content-contract";
process.loadEnvFile("apps/cms/.env");
const uri = new URL(process.env.DATABASE_URI!);
if (
  !["127.0.0.1", "localhost"].includes(uri.hostname) ||
  uri.pathname !== "/asoball_blog_dev" ||
  process.env.MEDIA_STORAGE === "gcs"
)
  throw new Error(
    "Acceptance seeding is restricted to the local development database and local media.",
  );
const { getPayload } = await import("payload");
const { default: config } = await import("../apps/cms/src/payload.config");
const payload = await getPayload({ config });
try {
  const user = (
    await payload.find({
      collection: "users",
      overrideAccess: true,
      where: { role: { equals: "admin" } },
      limit: 1,
    })
  ).docs[0];
  if (!user) throw new Error("Run pnpm bootstrap first.");
  const fixture = fixtureSnapshot();
  const categories = new Map<string, string | number>(),
    tags = new Map<string, string | number>();
  for (const category of fixture.categories) {
    const existing = (
      await payload.find({
        collection: "categories",
        user,
        overrideAccess: false,
        where: { slug: { equals: category.slug } },
        limit: 1,
      })
    ).docs[0];
    const doc =
      existing ||
      (await payload.create({
        collection: "categories",
        user,
        overrideAccess: false,
        data: category,
      }));
    categories.set(category.slug, doc.id);
  }
  for (const tag of fixture.tags) {
    const existing = (
      await payload.find({
        collection: "tags",
        user,
        overrideAccess: false,
        where: { slug: { equals: tag.slug } },
        limit: 1,
      })
    ).docs[0];
    const doc =
      existing ||
      (await payload.create({
        collection: "tags",
        user,
        overrideAccess: false,
        data: tag,
      }));
    tags.set(tag.slug, doc.id);
  }
  let media = (
    await payload.find({
      collection: "media",
      user,
      overrideAccess: false,
      where: { alt: { equals: "固定驗收圖：CMS 經內容快照輸出靜態網站" } },
      limit: 1,
    })
  ).docs[0];
  if (!media) {
    const bytes = await sharp(
      await readFile("apps/blog/public/fixture-diagram.svg"),
    )
      .png()
      .toBuffer();
    media = await payload.create({
      collection: "media",
      user,
      overrideAccess: false,
      data: { alt: "固定驗收圖：CMS 經內容快照輸出靜態網站" },
      file: {
        data: bytes,
        mimetype: "image/png",
        name: "fixture.png",
        size: bytes.length,
      },
    });
  }
  function lexical(node: ContentNode): Record<string, unknown> {
    if (node.type === "list")
      return {
        ...node,
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        tag: node.listType === "number" ? "ol" : "ul",
        start: 1,
        children: node.children?.map(lexical),
      };
    if (node.type === "listitem")
      return {
        ...node,
        version: 1,
        direction: null,
        format: "",
        indent: 0,
        value: 1,
        children: node.children
          ?.flatMap((child) =>
            child.type === "paragraph" ? child.children || [] : [child],
          )
          .map(lexical),
      };
    if (node.type === "link")
      return {
        type: "link",
        version: 3,
        direction: null,
        format: "",
        indent: 0,
        fields: {
          url: node.url,
          linkType: "custom",
          newTab: node.newTab || false,
        },
        children: node.children?.map(lexical),
      };
    if (node.type === "image")
      return {
        type: "upload",
        version: 1,
        relationTo: "media",
        value: media!.id,
        format: "",
        fields: {},
      };
    if (node.type === "table")
      return {
        type: "block",
        version: 2,
        format: "",
        fields: {
          blockType: "code",
          language: "text",
          code: "欄位       用途\nstatus     決定是否進入公開快照",
        },
      };
    return {
      ...node,
      version: node.type === "block" ? 2 : 1,
      direction: null,
      indent: 0,
      format: node.format ?? (node.type === "text" ? 0 : ""),
      ...(node.type === "text" ? { detail: 0, mode: "normal", style: "" } : {}),
      children: node.children?.map(lexical),
    };
  }
  let created = 0;
  for (const post of fixture.posts) {
    if (
      (
        await payload.find({
          collection: "posts",
          user,
          overrideAccess: false,
          where: { slug: { equals: post.slug } },
          limit: 1,
        })
      ).totalDocs
    )
      continue;
    await payload.create({
      collection: "posts",
      user,
      overrideAccess: false,
      data: {
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        content: { root: lexical(post.content.root) } as never,
        category: post.category
          ? categories.get(post.category.slug)
          : undefined,
        tags: post.tags.map((tag) => tags.get(tag.slug)!),
        coverImage: post.cover ? media.id : undefined,
        featured: post.featured,
        publishedAt: post.publishedAt,
        seoTitle: post.seo.title,
        seoDescription: post.seo.description,
        _status: "published",
      },
    });
    created++;
  }
  for (const draft of draftFixtures) {
    if (
      (
        await payload.find({
          collection: "posts",
          user,
          overrideAccess: false,
          where: { slug: { equals: draft.slug } },
          limit: 1,
        })
      ).totalDocs
    )
      continue;
    await payload.create({
      collection: "posts",
      user,
      overrideAccess: false,
      draft: true,
      data: {
        title: draft.title,
        slug: draft.slug,
        content: { root: lexical(fixture.posts[11].content.root) } as never,
        _status: "draft",
      },
    });
  }
  console.log(
    `Acceptance fixtures ready; created ${created} published posts, drafts remain private. Existing content was not overwritten.`,
  );
} finally {
  await payload.destroy();
}
process.exit(0);
