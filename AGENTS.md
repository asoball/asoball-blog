# Codex / Agent 工作規範

## 優先順序
1. 先閱讀 README.md、docs/PRD.md、docs/ARCHITECTURE.md、docs/DECISIONS.md、docs/TASKS.md，以及 docs/UI_UX_SPEC.md、docs/DESIGN_SYSTEM.md、docs/PAGE_WIREFRAMES.md、docs/FRONTEND_ACCEPTANCE.md。
2. 不自行改變已決策技術棧；若發現衝突，提出 ADR 和替代方案，等待確認。
3. 一次只處理 TASKS.md 中一個可驗收任務，先列出計畫、修改檔案和驗收標準。
4. 優先使用官方支援的 Payload/Next.js/Astro 套件與 API；套件版本鎖定，先查相容性矩陣再安裝。
5. 使用 TypeScript strict、ESLint、Prettier、Zod（外部資料邊界）、Vitest、Playwright。
6. 必須有可重現的本機環境、範例 `.env.example`、清楚的 README；不得提交 `.env`、私鑰、憑證。
7. 禁止無授權的破壞性命令、刪除 GCS 物件、刪除 Atlas Collection、Terraform apply、正式部署。
8. 任何 CMS mutation 必須有權限檢查；公開 Astro 僅可讀取 published 內容，禁止洩漏草稿。
9. 變更 Payload schema 時，先以本機 Docker MongoDB 驗證索引、交易與升級路徑，記錄 Atlas M0 待複驗項目；M0 真實驗證統一於本機開發及 UAT 完成後的 P05-04 執行，不阻擋本機任務。
10. 完成任務時執行適用的 lint、typecheck、unit、integration、build，回報執行命令與結果；若無法執行，明確註記。

## Repo 目標結構
```text
apps/blog/                  Astro SSG
apps/cms/                   Payload CMS + Next.js
packages/content-contract/  公開文章 DTO、Zod schemas、slug utils
scripts/                    內容匯出、快照、發布腳本
infrastructure/terraform/   GCP 資源
infrastructure/cloudbuild/  build/deploy pipelines
docs/                       設計文件
.github/workflows/          PR 檢查與 CMS 發布
```

## 前端視覺實作要求
- 已選定風格 D：首頁 Developer Blog、文章頁 Editorial Reading + Documentation TOC。不可自行改成純文件站或雜誌站。
- 前台 UI 必須遵守 docs/UI_UX_SPEC.md、docs/DESIGN_SYSTEM.md、docs/PAGE_WIREFRAMES.md，並逐項通過 docs/FRONTEND_ACCEPTANCE.md。
- 先實作共用 Design Tokens、元件與固定 seed fixture，再做頁面；先交付 mobile/desktop、light/dark 截圖供人工審核。
- 不得虛構作者資料、社群網址、文章內容或使用外部未授權圖片。
- Payload Admin UI 以官方內建後台為主，前台設計規範不代表重做 CMS 管理介面。

## 實作守則
- 開發順序：Phase 0～4 完成本機 CMS、前台、媒體、發布與完整 UAT，通過 P04-06 後才進入 Phase 5 雲端測試；本機任務不要求雲端資源、帳密或部署。本機成功不可宣稱通過雲端驗收。
- 公開站不在 request time 查 MongoDB；只讀取建置時的固定內容快照。
- CMS API 的公開讀取採最小資料欄位；draft/version/users 不可匿名取得。
- MongoDB 連線池須重用；Cloud Run 最大實例數先設 1，避免 M0 連線耗盡。
- 文章發布與刪除均應重建 sitemap / RSS / 相關列表；發布需去重、序列化、支援失敗重試與回滾。
- Rich Text 選 Payload Lexical；如需要 Markdown 輸出，透過受測轉換器產生 Astro 可用資料，禁止假設 Lexical JSON 等於 Markdown。
- 圖片上傳必須驗證 MIME、大小、權限；不要讓匿名訪客透過 CMS 代理取得私有草稿圖片。
- 部署相關指令必須先提供 dry-run/plan；任何額外月費服務需明確說明。

## 每次任務完成的回報格式
- 實作範圍與檔案清單
- 測試與建置結果（pass/fail/not run）
- 安全性與成本影響
- 剩餘風險／待確認事項
- 下一個任務 ID
