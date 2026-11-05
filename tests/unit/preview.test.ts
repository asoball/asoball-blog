import { it, expect } from "vitest";
import { previewContent } from "../../apps/cms/src/preview-content";
it("normalizes authenticated private media without exposing raw relationship fields", () => {
  const result = previewContent({
    type: "upload",
    relationTo: "media",
    value: {
      url: "/api/media/file/private.png",
      alt: "Private image",
      width: 64,
      height: 32,
      secret: "canary",
    },
  });
  expect(result.type).toBe("image");
  expect(JSON.stringify(result)).not.toContain("canary");
  expect(
    previewContent({
      type: "upload",
      relationTo: "media",
      value: { url: "javascript:alert(1)" },
    }).type,
  ).toBe("paragraph");
});
