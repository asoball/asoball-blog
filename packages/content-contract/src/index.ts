import { z } from "zod";
export const slugSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export function safeURL(value: string): boolean {
  if (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !value.includes("..")
  )
    return true;
  try {
    return ["https:", "http:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
export const taxonomySchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(300).optional(),
});
export const imageSchema = z.object({
  url: z.string().refine(safeURL),
  alt: z.string().min(1).max(300),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type ContentNode = {
  type: string;
  text?: string;
  tag?: string;
  format?: number | string;
  language?: string;
  url?: string;
  newTab?: boolean;
  listType?: string;
  value?: number;
  fields?: {
    blockType?: string;
    code?: string;
    language?: string;
    url?: string;
    newTab?: boolean;
  };
  image?: z.infer<typeof imageSchema>;
  children?: ContentNode[];
};
export const nodeSchema: z.ZodType<ContentNode> = z.lazy(() =>
  z.object({
    type: z.string().max(80),
    text: z.string().max(100000).optional(),
    tag: z.string().optional(),
    format: z.union([z.string(), z.number()]).optional(),
    language: z.string().optional(),
    url: z.string().optional(),
    newTab: z.boolean().optional(),
    listType: z.string().optional(),
    value: z.number().optional(),
    fields: z
      .object({
        blockType: z.string().optional(),
        code: z.string().max(100000).optional(),
        language: z.string().optional(),
        url: z.string().optional(),
        newTab: z.boolean().optional(),
      })
      .optional(),
    image: imageSchema.optional(),
    children: z.array(nodeSchema).max(2000).optional(),
  }),
);
export const postSchema = z.object({
  id: z.string(),
  slug: slugSchema,
  title: z.string().min(1).max(160),
  excerpt: z.string().max(300),
  content: z.object({ root: nodeSchema }),
  category: taxonomySchema.optional(),
  tags: z.array(taxonomySchema),
  cover: imageSchema.optional(),
  publishedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  featured: z.boolean().default(false),
  seo: z.object({
    title: z.string().max(160),
    description: z.string().max(300),
    canonicalPath: z.string().regex(/^\/posts\/[a-z0-9-]+\/$/),
  }),
});
export const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    posts: z.array(postSchema),
    categories: z.array(taxonomySchema),
    tags: z.array(taxonomySchema),
  })
  .strict();
export type PublicPost = z.infer<typeof postSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export const PAGE_SIZE = 9;
export function sortedPosts(posts: PublicPost[]) {
  return [...posts].sort(
    (a, b) =>
      b.publishedAt.localeCompare(a.publishedAt) ||
      a.slug.localeCompare(b.slug, "en"),
  );
}
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
export function textOf(node: ContentNode): string {
  return (node.text ?? "") + (node.children ?? []).map(textOf).join("");
}
export function readingMinutes(post: PublicPost) {
  return Math.max(1, Math.ceil(textOf(post.content.root).length / 500));
}
