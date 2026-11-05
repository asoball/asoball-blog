import {
  nodeSchema,
  imageSchema,
  type ContentNode,
} from "@asoball/content-contract";
// Only call after an authenticated, access-controlled Payload read with populated media.
export function previewContent(value: unknown, depth = 0): ContentNode {
  if (depth > 40 || !value || typeof value !== "object")
    throw new Error("Invalid preview content.");
  const node = value as Record<string, unknown>;
  if (node.type === "upload" && node.relationTo === "media") {
    const image = imageSchema.safeParse(node.value);
    return image.success
      ? { type: "image", image: image.data }
      : {
          type: "paragraph",
          children: [{ type: "text", text: "圖片無法載入" }],
        };
  }
  return nodeSchema.parse({
    ...node,
    value: typeof node.value === "number" ? node.value : undefined,
    children: Array.isArray(node.children)
      ? node.children.map((child) => previewContent(child, depth + 1))
      : undefined,
  });
}
