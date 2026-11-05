# PRD — 技術文章部落格

## 1. 目標與成功標準
提供個人技術文章網站：公開頁面速度快、SEO 良好、可由 CMS 管理文章與圖片，低流量時雲端成本可控。Codex 能按規格逐步開發、測試、部署。

成功標準：管理者可登入、新增草稿、預覽、上傳圖片、發布、更新與取消發布；訪客可在文章首頁、文章頁、分類/標籤頁閱讀；發布後在合理建置時間內上線；錯誤可追蹤、可回滾。

交付順序：Phase 0～4 先在本機完成上述功能與完整 UAT（Docker MongoDB、本機持久化媒體、本機靜態發布）；P04-06 通過後才進 Phase 5 雲端整合測試與 Phase 6 正式交付。雲端服務尚未建立不阻擋本機開發；本機驗收不等於雲端正式上線驗收。

## 2. 角色
- 訪客：匿名瀏覽 published 文章、分類、標籤、RSS、sitemap。
- 管理者：Payload 內建登入、文章/分類/標籤/媒體 CRUD、草稿預覽、發布、查看部署狀態。
- CI 發布身分：只讀 published 內容與媒體，執行建置及 Hosting 發布。

## 3. MVP 功能與驗收
| ID | 功能 | 驗收條件 |
|---|---|---|
| F01 | 首頁 | 最新 published 文章、標題/摘要/日期/封面，分頁 |
| F02 | 文章頁 | Rich Text、程式碼高亮、圖片、TOC、SEO metadata |
| F03 | 分類與標籤 | 對應列表、可分享 URL、空狀態 |
| F04 | SEO | canonical、Open Graph、robots、sitemap、RSS |
| F05 | CMS 登入 | 未授權不可存取管理頁與寫入 API |
| F06 | 文章管理 | CRUD、唯一 slug、草稿、預覽、發布/取消發布 |
| F07 | 媒體庫 | GCS 圖片上傳、格式與大小限制、alt text |
| F08 | 發布流程 | 已發布內容重建靜態網站；建置失敗保留舊站 |
| F09 | 可觀測性 | 部署記錄、錯誤日誌、費用預算告警 |
| F10 | RWD/可用性 | 手機可讀、鍵盤可操作、圖片有 alt、合理 Core Web Vitals |

## 4. 技術文章體驗
- 語法高亮、行內 code、可複製程式碼、目錄錨點、外部連結安全屬性。
- Mermaid 與 KaTeX 為 P1：先驗證 Lexical 內容表示及 Astro 渲染；不得把任意 HTML 當可信內容。
- 預覽必須透過受保護的 CMS 預覽路由，不能把 draft 直接公開到 Firebase Hosting。

## 5. 非功能需求
- 公開站靜態優先；CMS scale-to-zero；Atlas M0 容量、連線、網路限制需實測。
- 可用性：無 CMS/DB 時，已部署靜態網站仍可正常閱讀。
- 安全：最小權限、秘密管理、IP allowlist、管理 API 存取控制。
- 維護：可回滾前台 Hosting 版本；資料庫與媒體具備備份/匯出方案。

## 6. 不包含
留言、公開使用者註冊、站內會員、付費文章、複雜工作流、即時全文搜尋、推薦系統。

## 7. 前端風格 D（已決策）
- 首頁：現代 Developer Blog，Hero + 文章列表，簡潔而不密集。
- 文章頁：Editorial Reading 主欄 + Documentation 式右側 TOC；手機目錄收合。
- 支援 Light/Dark/System、鍵盤操作、RWD、程式碼複製；具體 UI 規格、token、線框、驗收分別見 `UI_UX_SPEC.md`、`DESIGN_SYSTEM.md`、`PAGE_WIREFRAMES.md`、`FRONTEND_ACCEPTANCE.md`。
- 不得以參考網站為由複製第三方品牌或素材。
