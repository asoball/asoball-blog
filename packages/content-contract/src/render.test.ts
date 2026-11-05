import { expect, it } from "vitest";
import { renderContent } from "./render";
import { sampleContent } from "./fixture";
it("renders safe headings, duplicate anchors, tables and code", async () => {
  const result = await renderContent(sampleContent);
  expect(result.toc.map((item) => item.id)).toEqual([
    "內容與資料邊界",
    "固定快照",
    "內容與資料邊界-2",
  ]);
  expect(result.html).toContain("shiki");
  expect(result.html).toContain("table-scroll");
});
it("never executes unknown nodes or unsafe links", async () => {
  const result = await renderContent({
    type: "root",
    children: [
      { type: "html", text: "<script>alert(1)</script>" },
      {
        type: "link",
        url: "javascript:alert(1)",
        children: [{ type: "text", text: "link" }],
      },
    ],
  });
  expect(result.html).not.toContain("<script>");
  expect(result.html).not.toContain("javascript:");
  expect(result.warnings).toEqual(["html"]);
});
