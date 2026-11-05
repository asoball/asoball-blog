import { describe, expect, it } from "vitest";
import {
  snapshotSchema,
  sortedPosts,
  slugSchema,
  safeURL,
  dateLabel,
} from "./index";
import { fixtureSnapshot } from "./fixture";
describe("public contract boundaries", () => {
  it("rejects invalid slugs and executable URLs", () => {
    for (const value of ["../draft", "Upper", "a/b", ""])
      expect(slugSchema.safeParse(value).success).toBe(false);
    for (const value of [
      "javascript:alert(1)",
      "//evil.test",
      "/\\evil",
      "data:text/html,hi",
    ])
      expect(safeURL(value)).toBe(false);
  });
  it("rejects unknown snapshot fields", () =>
    expect(() =>
      snapshotSchema.parse({ ...fixtureSnapshot(), users: [] }),
    ).toThrow());
  it("orders same dates deterministically and uses UTC dates", () => {
    const a = fixtureSnapshot().posts[0];
    expect(
      sortedPosts([
        { ...a, slug: "z" },
        { ...a, slug: "a" },
      ]).map((p) => p.slug),
    ).toEqual(["a", "z"]);
    expect(dateLabel("2026-11-04T23:59:00.000Z")).toContain("04");
  });
});
