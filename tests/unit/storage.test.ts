import { expect, it } from "vitest";
import { mediaStoragePlugin } from "../../apps/cms/src/storage";
import { referencesMedia } from "../../apps/cms/src/media";
it("fails closed for an incomplete GCS configuration and never enables public bypass", () => {
  expect(mediaStoragePlugin("local")).toEqual([]);
  expect(() => mediaStoragePlugin("gcs")).toThrow();
  expect(() => mediaStoragePlugin("unknown", "bucket")).toThrow();
  expect(mediaStoragePlugin("gcs", "test-private-bucket")).toHaveLength(1);
});
it("detects nested Lexical image references", () => {
  expect(
    referencesMedia(
      {
        root: {
          children: [
            { type: "upload", relationTo: "media", value: { id: "target" } },
          ],
        },
      },
      "target",
    ),
  ).toBe(true);
  expect(referencesMedia({ text: "target" }, "target")).toBe(false);
});
