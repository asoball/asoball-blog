import { it, expect } from "vitest";
import { privateGcsOptions } from "../../apps/cms/src/storage";
it("uses ADC and bucket IAM without per-object ACL or public access bypass", () => {
  const options = privateGcsOptions("test-private-media");
  expect(options).toMatchObject({
    bucket: "test-private-media",
    options: {},
    collections: { media: true },
  });
  expect(options).not.toHaveProperty("acl");
  expect(options).not.toHaveProperty("clientUploads");
});
