# Frontend Acceptance — Codex 驗收矩陣

驗收時程：FE-01～FE-15 於 Phase 3 實作測試，並於 P04-06 本機 UAT gate 完整通過；使用 localhost、fixture／本機快照與本機媒體，不要求 Atlas／GCS／Hosting。取消發布的產物移除先以受控快照重建驗證，Phase 4 再串接真實本機發布 E2E；雲端正式鏈路於 P05-08 複驗。

## 1. 環境與測試資料
- 使用固定的 seed fixture：至少 12 篇 published 文章、2 篇 draft、3 個分類、5 個標籤；含無封面文章、超長標題、中文/英文混排、圖片、程式碼、表格、引用、長 URL、H2/H3、無 H2 的短文。
- Fixture 不可含真實密鑰、個資或未授權素材；CI 建置應可離線使用本地 fixture 完成前台驗收。
- 固定時區/locale；測試截圖使用一致字型環境與 viewport，避免時間與字型差異造成無意義變動。

## 2. 功能驗收
| ID | 驗收條件 | 驗證方式 |
|---|---|---|
| FE-01 | 首頁 Hero、最新文章、精選有資料才顯示；列表排序與分頁穩定 | Playwright + fixture |
| FE-02 | Header/Footer 路由正確；手機選單可鍵盤操作與 Escape 關閉 | Playwright keyboard |
| FE-03 | Light/Dark/System 可切換、記憶偏好、無 JS 回退可讀 | Playwright + JS off |
| FE-04 | 文章 H1 唯一、H2/H3 TOC 與錨點對應、TOC sticky 不遮正文 | DOM assertions + screenshot |
| FE-05 | <1024px TOC 可收合，目錄連結可跳轉，anchor 不被 header 遮擋 | Playwright mobile |
| FE-06 | 程式碼高亮、複製按鈕、長程式碼橫向捲動；無 JS 仍顯示程式碼 | Playwright |
| FE-07 | 分類/標籤/文章列表/404/空狀態均正常且可導航 | Route assertions |
| FE-08 | published 顯示；draft/versions/users 不進入靜態產物 | Build artifact scan |
| FE-09 | canonical/OG/RSS/sitemap/robots 正確，取消發布後移除 URL | Build integration |
| FE-10 | 圖片 alt、尺寸或 aspect ratio、lazy load 與 fallback | DOM + screenshot |
| FE-11 | 未知 Lexical 節點不執行 HTML/script，安全 fallback | Unit + malicious fixture |
| FE-12 | 320/375/768/1024/1440px 不發生整頁水平溢出 | Playwright screenshot + overflow |
| FE-13 | 所有互動元件可鍵盤操作，focus 可見，語意 landmark 完整 | axe-core + manual keyboard |
| FE-14 | prefers-reduced-motion 下無非必要動畫 | Emulation |
| FE-15 | 日期、閱讀時間、長標題與中英文排版不破版 | Fixture screenshot |

## 3. 視覺驗收基準
- 截圖 viewports：320×740、375×812、768×1024、1024×768、1440×900；各測 Light 與 Dark（至少首頁、文章頁、分類頁）。
- 建立 `apps/blog/tests/visual/` baseline；初次 baseline 需人工審核，不可直接以更新 snapshot 掩蓋回歸。
- 檢查：文字不重疊、不截斷重要內容、不橫向溢出、TOC 與正文不互蓋、圖片不變形、code block 可捲動、Header 不遮錨點。
- 視覺差異需附 before/after 截圖與原因；字型渲染差異可調整容忍值，但不能忽略布局錯誤。

## 4. 可及性
- 使用 `@axe-core/playwright` 對首頁、文章、列表、404 執行自動檢測，目標 0 個 critical/serious violations。
- 人工測試鍵盤順序、SkipLink、TOC、ThemeSwitcher、手機選單、複製按鈕、螢幕閱讀器語意。
- 驗證 WCAG 2.2 AA 色彩對比；一般文字 >=4.5:1，大字 >=3:1，焦點輪廓明確。

## 5. 效能與建置
- Lighthouse CI 目標（mobile，固定測試環境）：Performance >=90、Accessibility >=95、Best Practices >=95、SEO >=95；若未達需附診斷與修正計畫，不得宣稱達標。
- Core Web Vitals 目標：LCP <=2.5s、CLS <=0.1、INP <=200ms（真實用戶數據需另行蒐集，實驗室數據不能替代）。
- 前台 HTML 與正文須可在禁用 JS 下閱讀；非必要互動不載入整頁 React hydration。
- `pnpm --filter blog build`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 必須通過。

## 6. Definition of Done
1. 對應功能驗收 ID 皆有自動化測試或明確人工測試證據。
2. Light/Dark、手機/桌面截圖經人工審核；無 blocker/critical UI 問題。
3. 無 draft 洩漏、無未授權 HTML、無機密資訊進入靜態產物。
4. 對應文件（UI_UX_SPEC、DESIGN_SYSTEM、PAGE_WIREFRAMES）與實作一致。
5. PR 附測試命令、結果、截圖、效能數據及尚存風險；未執行項目需明確標記。
