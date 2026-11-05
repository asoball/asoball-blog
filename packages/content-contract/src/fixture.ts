import { snapshotSchema, type ContentNode, type Snapshot } from "./index";
const text = (value: string): ContentNode => ({
  type: "text",
  text: value,
  format: 0,
});
const paragraph = (value: string): ContentNode => ({
  type: "paragraph",
  children: [text(value)],
});
export const categories = [
  { slug: "engineering", name: "工程實作", description: "驗收用分類" },
  { slug: "architecture", name: "架構筆記", description: "驗收用分類" },
  { slug: "empty", name: "尚無文章", description: "驗收空狀態" },
];
export const tags = [
  "typescript",
  "astro",
  "payload",
  "testing",
  "mongodb",
].map((slug) => ({ slug, name: slug }));
export const sampleContent: ContentNode = {
  type: "root",
  children: [
    { type: "heading", tag: "h2", children: [text("內容與資料邊界")] },
    paragraph(
      "這是固定驗收 fixture，不是真實作者文章。用於檢查繁體中文與 TypeScript、Astro 混排，以及不同螢幕上的閱讀排版。",
    ),
    {
      type: "paragraph",
      children: [
        { ...text("published-only"), format: 16 },
        text(" 代表靜態輸出僅包含已發布內容。"),
      ],
    },
    { type: "heading", tag: "h3", children: [text("固定快照")] },
    paragraph(
      "建置只讀取一份固定內容快照。以下程式碼、表格和圖像都是測試素材。",
    ),
    {
      type: "block",
      fields: {
        blockType: "code",
        language: "typescript",
        code:
          'const snapshot = { published: true };\nconsole.log(snapshot);\nconst longLine = "' +
          "immutable-snapshot-".repeat(16) +
          '";',
      },
    },
    {
      type: "quote",
      children: [paragraph("草稿與管理者資料應留在管理系統內。")],
    },
    { type: "heading", tag: "h2", children: [text("內容與資料邊界")] },
    {
      type: "table",
      children: [
        {
          type: "tablerow",
          children: [
            { type: "tableheader", children: [paragraph("欄位")] },
            { type: "tableheader", children: [paragraph("用途")] },
          ],
        },
        {
          type: "tablerow",
          children: [
            { type: "tablecell", children: [paragraph("status")] },
            {
              type: "tablecell",
              children: [paragraph("決定是否進入公開快照")],
            },
          ],
        },
      ],
    },
    {
      type: "image",
      image: {
        url: "/fixture-diagram.svg",
        alt: "驗收圖：CMS 經固定快照輸出至靜態網站",
        width: 960,
        height: 540,
      },
    },
    {
      type: "list",
      listType: "bullet",
      children: [
        { type: "listitem", children: [paragraph("先驗證資料，再產生頁面。")] },
        {
          type: "listitem",
          children: [paragraph("不依賴瀏覽器端查詢資料庫。")],
        },
      ],
    },
    {
      type: "paragraph",
      children: [
        {
          type: "link",
          url: "https://example.com/" + "long-url-".repeat(22),
          newTab: true,
          children: [text("https://example.com/" + "long-url-".repeat(22))],
        },
      ],
    },
  ],
};
export function fixtureSnapshot(): Snapshot {
  return snapshotSchema.parse({
    schemaVersion: 1,
    categories,
    tags,
    posts: Array.from({ length: 12 }, (_, i) => ({
      id: `fixture-${i + 1}`,
      slug: `fixture-${i + 1}`,
      title:
        i === 0
          ? "驗收範例｜從 CMS 到固定快照：繁體中文與 English 技術內容的長標題閱讀測試"
          : "驗收範例｜工程筆記 " + String(i + 1).padStart(2, "0"),
      excerpt:
        "這是本機固定測試資料，用於驗證文章列表、閱讀排版與靜態發布流程。",
      content:
        i === 11
          ? {
              root: {
                type: "root",
                children: [paragraph("沒有章節標題的短篇驗收 fixture。")],
              },
            }
          : { root: sampleContent },
      category: categories[i % 2],
      tags: [tags[i % 5], tags[(i + 1) % 5]],
      ...(i % 3 === 0
        ? {
            cover: {
              url: "/fixture-diagram.svg",
              alt: "固定驗收圖：CMS 與靜態快照",
              width: 960,
              height: 540,
            },
          }
        : {}),
      publishedAt: `2026-10-${String(20 - i).padStart(2, "0")}T00:00:00.000Z`,
      updatedAt: "2026-11-01T00:00:00.000Z",
      featured: i === 1,
      seo: {
        title: "驗收範例 " + (i + 1),
        description: "本機固定測試資料",
        canonicalPath: `/posts/fixture-${i + 1}/`,
      },
    })),
  });
}
export const draftFixtures = ["DRAFT_CANARY_ONE", "DRAFT_CANARY_TWO"].map(
  (title, i) => ({ title, slug: `draft-${i + 1}`, _status: "draft" }),
);
