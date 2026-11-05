# Codex 實作工作清單

規劃修訂：2026-11-05。Phase 0～4 本機實作、自動化與使用者 UAT 已通過；依使用者決策，後續才進行雲端測試。證據見 [LOCAL_UAT](LOCAL_UAT.md)。

規則：每次只做一個可驗收任務；依下列階段與任務順序推進。Phase 0～4 不要求 Atlas、GCP、GCS、Firebase、雲端帳密或付費資源。雲端驗收是正式上線的前置條件，不阻擋本機開發。

## Phase 0 — 本機技術 PoC

本機 MongoDB 使用根目錄 Docker Compose 常駐單節點 replica set 與具名 volume；所有本機測試直接連線，不使用 mongodb-memory-server。證據見 [相容性紀錄](COMPATIBILITY_POC.md) 與 [執行方法](../poc/p00-01/README.md)。

- [x] **P00-01** 驗證 Payload + Next.js + Docker MongoDB 官方版本相容性，記錄版本矩陣。驗收：Local API 登入、CRUD、draft/version/restore、唯一索引、關聯、ACL、本機 build 通過，Docker 重啟保留資料。已完成的是本機驗證；Atlas 真實限制移至 P05-04。
- **P00-02（移轉）** 原 Cloud Run / NAT / Atlas 網路驗證移至 P05-03，不再是 Phase 0 前置任務。
- **P00-03（移轉）** 原 GCS 與 Cloud Run 重啟持久化驗證移至 P05-05；本機媒體功能由 P02-04 驗收。
- [x] **P00-04** 以本機 Payload published DTO / 固定 fixture 驗證 Astro SSG 與 Lexical code block 渲染。驗收：不連雲端也能產生文章，draft 不進靜態產物。

## Phase 1 — Repo 與本機開發基礎

- [x] **P01-01** pnpm monorepo、TypeScript strict、ESLint、Prettier、Vitest、Playwright。驗收：根目錄 lint/typecheck/test/build 可執行。
- [x] **P01-02** 建立 apps/cms Payload template + MongoDB adapter，沿用 Docker MongoDB。驗收：本機 CMS 啟動、瀏覽器管理者登入、開發／測試 database 隔離。
- [x] **P01-03** 建立 apps/blog Astro、Tailwind、共用 DTO package，導入 DESIGN_SYSTEM tokens 與固定 seed fixture。驗收：靜態首頁與文章樣板可建置，tokens 只有單一來源。
- [x] **P01-04** GitHub Actions PR CI 與 dependency scan 設定。驗收：檢查命令可在本機重現，CI 不需雲端部署身分或 production secrets；遠端執行證據於連接 repo 後補充，不阻擋本機開發。

## Phase 2 — 本機 CMS 功能

- [x] **P02-01** Users、Posts、Categories、Tags、Media collections；唯一 slug 與驗證。驗收：Docker MongoDB CRUD/關聯/索引/升級回歸測試，列出待雲端複驗項目。
- [x] **P02-02** 角色/ACL、關閉公開註冊、草稿/版本。驗收：匿名讀不到 draft/versions/users，匿名不能寫入。
- [x] **P02-03** Lexical 技術文章 code block、圖片 alt、SEO 與受保護預覽。驗收：本機編輯/預覽/儲存正確。
- [x] **P02-04** 本機媒體儲存、MIME/5MB 限制、alt 與公開/私人存取。使用 Payload 本機 upload 與持久化目錄／volume；草稿媒體不得暴露於公開靜態目錄。同時完成官方 GCS adapter 的環境切換設定，以測試替身驗證契約，不連 GCS。驗收：本機媒體 E2E、匿名權限、CMS 重啟持久化及 adapter 設定檢查。

## Phase 3 — 本機 Astro 前台

- [x] **P03-00** 依 UI_UX_SPEC / DESIGN_SYSTEM / PAGE_WIREFRAMES 實作 SiteHeader、MobileNav、ThemeSwitcher、SiteFooter、ArticleCard 等共用元件。驗收：mobile/desktop 與 light/dark 首輪截圖經人工審核。
- [x] **P03-01** 文章列表、分頁、文章詳情、分類/標籤。驗收：published 靜態頁可由本機快照建置。
- [x] **P03-02** Lexical renderer、語法高亮、TOC、圖片最佳化。驗收：長文與 code block 正確。
- [x] **P03-03** canonical/OG/sitemap/RSS/robots/404/RWD。驗收：本機 SEO smoke test，測試網域由設定注入。
- [x] **P03-04** 按 FRONTEND_ACCEPTANCE.md 完成 Playwright 視覺回歸、axe、鍵盤、無 JS、Lighthouse CI 驗收。驗收：FE-01～FE-15 逐項有證據；不達標需修正後重驗。

## Phase 4 — 本機發布流程與完整驗收

- [x] **P04-01** Published DTO 匯出 + immutable snapshot，先儲存本機固定路徑，完成雲端儲存 adapter 程式及契約測試。驗收：草稿與私有媒體不外洩、snapshot 可重現、建置期間不混用內容版本；無雲端呼叫。
- [x] **P04-02** 發布請求、去重、序列化、狀態追蹤與重試。採可於 Docker MongoDB 驗證的原子狀態控制，發布執行器先呼叫本機 build。驗收：併發不覆蓋新版、失敗可重試，無需雲端佇列。
- [x] **P04-03** Payload hook 接發布/取消發布/刪除，串起本機 snapshot → Astro build → 靜態預覽服務。驗收：E2E 內容一致，取消發布／刪除更新列表、RSS、sitemap，草稿儲存不發布。
- [x] **P04-04** 本機 release 切換與 rollback，完成 Terraform、Cloud Build、Firebase、IAM/WIF 設定檔及 build/deploy adapter 程式。驗收：本機 build 失敗保留舊版、舊 release 不覆蓋新版；設定及契約可在本機檢查，Terraform fmt/validate 使用不連遠端 backend 的初始化；不執行需要雲端身分的 plan 或實際部署。
- [x] **P04-05** CMS multi-stage Docker image、健康檢查、DB／媒體匯出還原與維運文件。驗收：本機容器登入/媒體/重啟、專用測試資料還原演練，無 secrets 進 image。
- [x] **P04-06** 本機 UAT gate。驗收：必要 lint/typecheck/unit/integration/build、CMS 到前台完整 E2E、FE-01～FE-15、失敗注入與資料還原皆通過；雲端 adapter、部署及基礎設施設定檔已完成本機檢查，僅留真實雲端環境驗證。人工確認視覺與本機 UAT，列清雲端待驗清單。通過後才可進 Phase 5。

## Phase 5 — 雲端測試環境與整合驗證

前置：P04-06 本機 UAT 通過。先核對官方服務限制、版本、區域、成本與身分，再提供 plan；建立資源、IAM 變更與部署仍依授權規範執行。本規劃調整不等於授權建立雲端資源。

- [ ] **P05-01** 複核已完成的 Terraform／部署設定，填入測試環境參數並產生正式雲端 plan 與費用明細。驗收：plan 可審核，不執行 apply；需要雲端身分的 plan 僅於本階段執行。
- [ ] **P05-02** 經授權建立測試用 VPC/subnet/Router/NAT/static IPv4、GCS、Artifact Registry、Cloud Run/SA/Secrets 與 Atlas M0。驗收：資源、權限、預算告警及清理計畫符合已審核 plan。
- [ ] **P05-03** Cloud Run Direct VPC egress + Cloud NAT static IPv4 + Atlas allowlist（原 P00-02）。驗收：出口 IPv4 一致、Atlas 僅允許 /32、TLS 成功、非允許來源被拒。
- [ ] **P05-04** Atlas M0 相容性複驗（原 P00-01 雲端部分）。驗收：用正式 schema 重跑登入、CRUD、draft/version/restore、索引、關聯、交易、ACL 與升級回歸，記錄實際版本及限制；不通過則修正並重驗本機與雲端，不直接上線。
- [ ] **P05-05** 切換官方 GCS media adapter（原 P00-03 與 P02-04 雲端部分）。驗收：上傳/讀取/刪除、匿名隔離、私人草稿圖片、Cloud Run 重啟持久化與 published 媒體公開路徑。
- [ ] **P05-06** CMS image 部署測試 Cloud Run。驗收：登入、媒體、cold start、健康檢查、max-instances=1、連線池與 Secrets。
- [ ] **P05-07** Firebase Hosting 測試站。驗收：靜態首頁/文章/404/HTTPS/SEO；先用測試預設網域，自訂域名依實際設定驗證。
- [ ] **P05-08** Cloud Build + Firebase 發布、雲端 snapshot 存取、專用 IAM/WIF、Payload hook。沿用本機發布契約與原子狀態設計。驗收：發布/取消發布/刪除 E2E、去重、序列化、重試、較舊 build 拒絕部署與失敗保留舊站。
- [ ] **P05-09** Hosting rollback、Cloud Run revision rollback。驗收：雲端測試環境演練成功，schema 相容性及資料影響已記錄。

## Phase 6 — 雲端營運驗收與正式交付

- [ ] **P06-01** CI/CD 權限與供應鏈複驗（PR CI 已於 P01-04 設定）。驗收：WIF、最小權限、dependency/image scan、無長期 key、不可變 artifact。
- [ ] **P06-02** Logging/Monitoring/Budget Alert/Atlas alerts。驗收：測試告警可收到，日誌可關聯 release 且無秘密。
- [ ] **P06-03** 雲端 DB/GCS 備份、還原演練、維運手冊。驗收：測試環境成功還原，實測 RPO/RTO 與費用已記錄。
- [ ] **P06-04** 雲端安全/效能與最終 UAT。驗收：TEST_PLAN 所有雲端必要案例通過；確認正式部署計畫、回滾與人工核准後才上線。

## 舊任務對照（本次修訂後以新版定義為準）

| 原任務 | 新位置 |
|---|---|
| P00-01 的 M0 真實測試 | P05-04；P00-01 僅本機 PoC |
| P00-02 NAT／Atlas 網路 | P05-03 |
| P00-03 GCS | P05-05 |
| P02-04 GCS 整合 | P02-04 先完成本機媒體；雲端差異在 P05-05 |
| 原 Phase 4 Infrastructure | 新 Phase 5；CMS image 本機驗證提前至 P04-05 |
| 原 P05-01／P05-02 snapshot／發布控制 | P04-01／P04-02；雲端複驗在 P05-08 |
| 原 P05-03 Cloud Build／Firebase | P04-04 準備與本機驗證、P05-08 雲端驗收 |
| 原 P05-04 hook | P04-03 本機 E2E、P05-08 雲端 E2E |
| 原 P05-05 rollback | P04-04 本機版本切換、P05-09 雲端回滾 |
| 原 P06-01 CI／WIF | P01-04 PR CI、P05-08 WIF、P06-01 複驗 |

下一個實作任務：**P05-01**。本次未進入雲端測試或部署；Phase 5～6 保留未完成。

