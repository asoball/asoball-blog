import { it, expect } from "vitest";
import { contentMediaIds } from "../../packages/publishing/src/snapshot";
import { writeCloudSnapshot } from "../../packages/publishing/src/cloud";
it("extracts only actual Lexical upload references", () =>
  expect([
    ...contentMediaIds({
      root: {
        children: [
          { type: "upload", relationTo: "media", value: "abc" },
          { type: "text", text: "not-a-reference" },
        ],
      },
    }),
  ]).toEqual(["abc"]));
it("cloud snapshot writes are create-only and propagate storage failures", async () => {
  let opts: unknown;
  await writeCloudSnapshot(
    {
      save: async (_data, options) => {
        opts = options;
      },
    },
    Buffer.from("{}"),
  );
  expect(opts).toMatchObject({ preconditionOpts: { ifGenerationMatch: 0 } });
  await expect(
    writeCloudSnapshot(
      {
        save: async () => {
          throw new Error("generation collision");
        },
      },
      Buffer.from("{}"),
    ),
  ).rejects.toThrow("generation collision");
});
