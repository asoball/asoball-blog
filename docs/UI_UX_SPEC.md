# UI/UX 規格 — Hybrid Developer Blog × Editorial Reading × Documentation

版本：1.1｜狀態：已選定視覺方向 D；實作細節以本文件為準。

## 1. 產品體驗定位
- 首頁採現代 Developer Blog：俐落、留白、清楚的個人技術定位；避免新聞入口式密集卡片。
- 文章頁採 Medium 式閱讀節奏 + Documentation 式右側目錄：長文閱讀優先，技術內容容易查找。
- 繁體中文為主要介面語言；英文技術名詞與程式碼混排須舒適。
- 公開站使用 Astro SSG，不在瀏覽時請求 CMS 或 MongoDB。無 JS 時文章、連結與主要導航仍可使用。
- 視覺參考是方向而非複製任何第三方網站之版型、商標或素材。

## 2. 資訊架構與 URL
| 路由 | 用途 | 主要區塊 |
|---|---|---|
| `/` | 首頁 | Hero、精選/最新文章、分類入口、頁尾 |
| `/posts/` | 全部文章 | 標題、文章列表、分頁、分類篩選連結 |
| `/posts/[slug]/` | 文章詳細頁 | 麵包屑、文章標頭、正文、TOC、上下篇/相關文章 |
| `/categories/` | 分類總覽 | 分類名稱與文章數 |
| `/categories/[slug]/` | 分類文章列表 | 分類說明、文章列表、分頁 |
| `/tags/[slug]/` | 標籤文章列表 | 標籤名稱、文章列表、分頁 |
| `/about/` | 作者/網站介紹 | 個人介紹、技術領域、外部連結 |
| `/404` | 找不到頁面 | 友善說明、回首頁/文章列表 |
| `/rss.xml`, `/sitemap-index.xml` | 發布輸出 | RSS / Sitemap（實際 sitemap 路徑依 Astro 插件確認） |

- URL 使用小寫、kebab-case、尾斜線一致；既有 slug 不可因標題編輯而自動更動。
- 分頁以靜態路徑 `/posts/page/2/` 等產生；第 1 頁 canonical 指向 `/posts/`。
- 分類與標籤是可分享、可索引的靜態頁；零文章分類可顯示空狀態，但避免生成無價值索引頁。

## 3. 全站版面
### Header
- 高度 desktop 72px / mobile 64px；內容最大寬度 1200px。
- 左側 Logo/站名，右側「文章」「分類」「關於」、主題切換；小螢幕以可操作的選單按鈕收合。
- Header 可 sticky；滾動時保持簡潔，不覆蓋文章錨點；加入 `scroll-margin-top`。
- 目前所在頁導航需有 aria-current。

### Footer
- 站名、簡短定位、文章/RSS/GitHub 等可配置連結、版權年份；禁止虛構社群網址。
- 外部連結 `target=_blank` 時加 `rel=noopener noreferrer`；不必全部強制新分頁。

### 首頁
- Hero：一句清楚定位的標題（預設佔位文案，後續可設定）、1–2 行副標、文章入口。
- 精選文章：若沒有精選旗標則隱藏整個區塊，不虛構精選。
- 最新文章：桌面 2 欄卡片、平板 2 欄、手機 1 欄；日期、標題、摘要、分類/標籤，封面可選。
- 卡片整體可點擊或標題可點擊，避免巢狀互動；hover/focus 有清楚狀態。
- 每頁預設 9 篇（可在單一設定常數調整），按日期遞減，日期相同以 slug 決定穩定排序。

### 文章頁
- 文章標頭：麵包屑、分類、H1、摘要（可選）、發表/更新日期、閱讀時間（估算）、標籤。
- 桌面：主欄最大 720px；右側 TOC 220px，sticky 且只列 H2/H3；內容與 TOC 間距 48px。
- TOC 在寬度 < 1024px 時改為正文上方可收合的「本文目錄」；避免遮住正文。
- 正文：標題層級、引用、列表、表格、圖片、程式碼、水平線；支援長 URL 與超寬表格橫向捲動。
- 程式碼：顯示語言標籤、複製按鈕、語法高亮、水平捲動；複製成功狀態可被輔助科技感知。
- 圖片保留比例、alt、可選圖說，防止 layout shift；內容中不可依賴不受信任 HTML。
- 文章末尾：標籤、相關文章（同分類/標籤，最多 3 篇）、回文章列表；資料不足時自然隱藏。
- 不顯示公開留言、登入、付費牆或虛構社交統計。

### 列表與空狀態
- 分類/標籤頁沿用相同 ArticleCard 元件；標題與說明統一。
- 無文章時顯示簡潔說明與返回文章列表連結，不顯示空白區域。
- 404 包含可用的主導航和回首頁按鈕。

## 4. 互動規範
- Light / Dark / System 三態，預設 System；偏好存 `localStorage`，初始化避免閃白，無 JS 回退至 system。
- TOC 點擊使用原生 anchor；目標標題具唯一 ID；可用 IntersectionObserver 增強目前章節指示，但非必要。
- 手機導航支援 Escape 關閉、焦點管理、aria-expanded；背景不得無法操作或造成鍵盤陷阱。
- 搜尋功能不在 v1 範圍；不得產生無功能的搜尋框。
- 不使用自動輪播、滾動劫持、沉重入場動畫；尊重 `prefers-reduced-motion`。
- 日期使用 `zh-TW` 呈現；時間以資料來源的 UTC ISO 日期為準，避免 build 時區造成跨日錯誤。

## 5. 響應式規則
- Mobile: 320–639px，單欄，內距 16px；不允許整頁水平溢出。
- Tablet: 640–1023px，內距 24px；卡片可 2 欄；TOC 折疊。
- Desktop: 1024–1279px，內距 32px；文章主欄 + TOC。
- Wide: >=1280px，容器最大 1200px 並置中；正文不隨螢幕無限加寬。
- 觸控目標至少 44×44px；不可只靠 hover 暴露必要操作。

## 6. 可及性與 SEO
- 目標 WCAG 2.2 AA：語意 HTML、跳至主要內容連結、可見 focus ring、鍵盤可操作、色彩對比符合標準。
- 每頁一個 H1；正文 H2/H3 順序合理；TOC 使用 nav + aria-label。
- 對正文中的圖片要求有意義 alt（裝飾圖片 alt 空字串）；code copy button 有明確標籤。
- Meta title、description、canonical、OG/Twitter metadata、RSS、sitemap 與 404 依既有 PRD；OG fallback 使用專案自有素材或純色模板。
- 首屏圖片優先載入，其餘圖片 lazy load；避免非必要 client-side hydration。

## 7. 元件清單
`SiteHeader`, `MobileNav`, `ThemeSwitcher`, `SiteFooter`, `Container`, `Hero`, `ArticleCard`, `ArticleGrid`, `Pagination`, `CategoryPill`, `TagList`, `Breadcrumbs`, `ArticleHeader`, `Prose`, `CodeBlock`, `TableOfContents`, `RelatedArticles`, `EmptyState`, `SkipLink`。
- 元件 props 必須 typed；避免將 CMS 原始 Lexical JSON 直接傳到 client。
- 內容渲染器必須只允許受支援的 Lexical 節點；未知節點有安全 fallback 並記錄 build 警告。

## 8. CMS 編輯體驗邊界
- CMS 後台以 Payload 官方管理介面為基礎，不重新設計整套管理 UI。
- 自訂欄位標籤、help text、必填驗證、預覽按鈕與發布狀態需一致。
- 公開站的 ThemeSwitcher、Header、Footer 不應直接套用到 Payload Admin UI。

## 9. 明確非目標
v1 不做公開站全文搜尋、會員、留言、互動排行榜、個人化推薦、閱讀進度跨裝置同步；Mermaid/KaTeX 待 PoC 驗證後列為 P1。
