import {
  APIError,
  type CollectionConfig,
  type CollectionBeforeDeleteHook,
} from "payload";
import { slugSchema } from "@asoball/content-contract";
import { isAdmin, publishedOnly } from "./access";
import path from "node:path";
import { localDataDir } from "./paths";
import { validateImage, preventMediaDelete } from "./media";
import {
  captureDraft,
  postChanged,
  postDeleted,
  taxonomyChanged,
  taxonomyDeleted,
  mediaChanged,
} from "./publishing-hooks";

const mutations = { create: isAdmin, update: isAdmin, delete: isAdmin };
const slug = {
  name: "slug",
  type: "text" as const,
  required: true,
  unique: true,
  validate: (value: unknown) =>
    slugSchema.safeParse(value).success ||
    "Use lowercase kebab-case (a-z, 0-9).",
};
const preventReferencedDelete =
  (field: "category" | "tags" | "coverImage"): CollectionBeforeDeleteHook =>
  async ({ req, id }) => {
    const related = await req.payload.find({
      collection: "posts",
      overrideAccess: false,
      req,
      where: { [field]: { equals: id } },
      limit: 1,
      depth: 0,
    });
    if (related.totalDocs)
      throw new APIError(
        "Remove post references before deleting this record.",
        409,
      );
  };
export const Users: CollectionConfig = {
  slug: "users",
  auth: { maxLoginAttempts: 5, lockTime: 600000 },
  admin: { useAsTitle: "email" },
  access: { ...mutations, read: isAdmin, admin: isAdmin },
  hooks: {
    beforeOperation: [
      ({ operation, req }) => {
        if (
          operation === "create" &&
          !isAdmin({ req }) &&
          req.context.bootstrap !== true
        )
          throw new APIError("Use the trusted local bootstrap CLI.", 403);
      },
    ],
  },
  fields: [
    {
      name: "role",
      type: "select",
      options: ["admin"],
      required: true,
      defaultValue: "admin",
      access: { create: isAdmin, update: isAdmin },
    },
  ],
};
export const Categories: CollectionConfig = {
  slug: "categories",
  admin: { useAsTitle: "name" },
  access: { ...mutations, read: () => true },
  hooks: {
    beforeOperation: [captureDraft],
    beforeDelete: [preventReferencedDelete("category")],
    afterChange: [taxonomyChanged],
    afterDelete: [taxonomyDeleted],
  },
  fields: [
    { name: "name", type: "text", required: true, maxLength: 100 },
    slug,
    { name: "description", type: "textarea", maxLength: 300 },
  ],
};
export const Tags: CollectionConfig = {
  ...Categories,
  slug: "tags",
  hooks: {
    beforeOperation: [captureDraft],
    beforeDelete: [preventReferencedDelete("tags")],
    afterChange: [taxonomyChanged],
    afterDelete: [taxonomyDeleted],
  },
};
export const Posts: CollectionConfig = {
  slug: "posts",
  admin: {
    useAsTitle: "title",
    defaultColumns: ["title", "_status", "publishedAt"],
    preview: ({ id }) => `/preview/${String(id)}`,
  },
  access: { ...mutations, read: publishedOnly, readVersions: isAdmin },
  versions: { drafts: { autosave: false }, maxPerDoc: 10 },
  hooks: {
    beforeOperation: [captureDraft],
    afterChange: [postChanged],
    afterDelete: [postDeleted],
    beforeChange: [
      ({ data, originalDoc }) => {
        if (
          originalDoc?.slugLocked &&
          data.slug &&
          data.slug !== originalDoc.slug
        )
          throw new APIError("Published slugs are immutable.", 400);
        data.slugLocked = Boolean(
          originalDoc?.slugLocked ||
          originalDoc?._status === "published" ||
          data._status === "published",
        );
        if (data._status === "published" && !data.publishedAt)
          data.publishedAt =
            originalDoc?.publishedAt || new Date().toISOString();
        return data;
      },
    ],
  },
  fields: [
    { name: "title", type: "text", required: true, maxLength: 160 },
    slug,
    { name: "excerpt", type: "textarea", maxLength: 300 },
    {
      name: "content",
      type: "richText",
      required: true,
      access: { read: isAdmin },
    },
    { name: "category", type: "relationship", relationTo: "categories" },
    { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
    {
      name: "coverImage",
      type: "upload",
      relationTo: "media",
      access: { read: isAdmin },
    },
    { name: "featured", type: "checkbox", defaultValue: false },
    { name: "publishedAt", type: "date" },
    { name: "seoTitle", type: "text", maxLength: 160 },
    { name: "seoDescription", type: "textarea", maxLength: 300 },
    {
      name: "slugLocked",
      type: "checkbox",
      admin: { hidden: true },
      access: { read: isAdmin },
    },
  ],
};
export const Media: CollectionConfig = {
  slug: "media",
  access: { ...mutations, read: isAdmin },
  upload: {
    staticDir: path.join(localDataDir, "media"),
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
  },
  hooks: {
    beforeOperation: [captureDraft, validateImage],
    beforeDelete: [preventMediaDelete],
    afterChange: [mediaChanged],
  },
  fields: [{ name: "alt", type: "text", required: true, maxLength: 300 }],
};
export const Deployments: CollectionConfig = {
  slug: "deployments",
  dbName: "publish_jobs",
  timestamps: false,
  admin: {
    useAsTitle: "seq",
    defaultColumns: ["seq", "state", "attempts", "reason", "createdAt"],
  },
  access: {
    read: isAdmin,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: "seq", type: "number", required: true },
    {
      name: "state",
      type: "select",
      options: ["queued", "running", "succeeded", "failed", "superseded"],
    },
    { name: "attempts", type: "number" },
    { name: "reason", type: "text" },
    { name: "releaseId", type: "text" },
    { name: "errorCode", type: "text" },
    { name: "createdAt", type: "date" },
    { name: "availableAt", type: "date" },
  ],
};
