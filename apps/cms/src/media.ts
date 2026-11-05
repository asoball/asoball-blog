import {
  APIError,
  type CollectionBeforeOperationHook,
  type CollectionBeforeDeleteHook,
} from "payload";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
const mimeFormat: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
  "image/avif": "heif",
};
export const validateImage: CollectionBeforeOperationHook = async ({ req }) => {
  const file = req.file;
  if (!file) return;
  if (file.size > 5 * 1024 * 1024)
    throw new APIError("Image exceeds 5MB.", 413);
  const expected = mimeFormat[file.mimetype];
  if (!expected) throw new APIError("Unsupported image type.", 400);
  try {
    const metadata = await sharp(file.data, {
      limitInputPixels: 40000000,
    }).metadata();
    if (metadata.format !== expected || !metadata.width || !metadata.height)
      throw new Error("Invalid image");
  } catch {
    throw new APIError("Image bytes do not match its declared MIME type.", 400);
  }
  file.name = `${randomUUID()}.${file.mimetype === "image/jpeg" ? "jpg" : file.mimetype.split("/")[1]}`;
};
export function referencesMedia(value: unknown, id: string | number): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value))
    return value.some((item) => referencesMedia(item, id));
  const obj = value as Record<string, unknown>;
  if (obj.type === "upload" && obj.relationTo === "media") {
    const related =
      typeof obj.value === "object" && obj.value
        ? (obj.value as Record<string, unknown>).id
        : obj.value;
    if (String(related) === String(id)) return true;
  }
  return Object.values(obj).some((item) => referencesMedia(item, id));
}
export const preventMediaDelete: CollectionBeforeDeleteHook = async ({
  req,
  id,
}) => {
  let page = 1;
  do {
    const result = await req.payload.find({
      collection: "posts",
      req,
      overrideAccess: true,
      depth: 0,
      page,
      limit: 100,
    });
    if (
      result.docs.some(
        (post) =>
          String(
            typeof post.coverImage === "object"
              ? post.coverImage?.id
              : post.coverImage,
          ) === String(id) || referencesMedia(post.content, id),
      )
    )
      throw new APIError(
        "Remove post media references before deleting this file.",
        409,
      );
    if (!result.hasNextPage) break;
    page++;
  } while (true);
};
