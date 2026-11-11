# Asoball Blog — 專案與操作說明

版本：1.3（2026-11-12）｜狀態：本機 Phase 0～4 驗收完成；雲端 CMS 已由操作者確認可登入，完整雲端驗收待完成｜讀者：Codex / 開發者

## 專案介紹

個人技術部落格，提供文章、分類、標籤、RSS 與管理後台。管理者可建立草稿、預覽、上傳圖片、發布、更新及取消發布。公開網站只讀取建置時的內容快照，不在瀏覽時查詢 CMS 或 MongoDB；發布支援去重、序列化、失敗重試與回滾。

## 技術棧與部署架構

| 項目           | 技術                                                                 |
| -------------- | -------------------------------------------------------------------- |
| 公開前台       | Astro 7.4.5 SSG、Tailwind CSS 4.3.4、Shiki 4.6.0                     |
| 管理後台       | Payload CMS 3.92.1、Next.js 16.4.5、React 19.3.1、Payload Lexical    |
| 本機資料庫     | Docker MongoDB 8.0.16，單節點 rs0 replica set、持久化 volume         |
| 本機媒體／發布 | 私有檔案目錄、Sharp、immutable snapshot、Astro build 與 release 切換 |
| 語言與工具     | TypeScript strict、Zod、Node.js 22.23.4、pnpm 10.34.9                |
| 品質檢查       | ESLint、Prettier、Vitest、Playwright、axe-core、Lighthouse CI        |

實際版本以 workspace package.json 與 pnpm-lock.yaml 為準。以下為雲端目標架構；本機開發不需雲端帳密或資源：

- 公開網站：Astro SSG，Firebase Hosting 靜態部署。
- CMS：Payload CMS（Next.js），GCP Cloud Run，單一服務；不使用 FastAPI。
- 內容與管理者：MongoDB Atlas M0（免費方案，須驗證功能與配額）。
- 圖片：GCS，Payload 官方 `@payloadcms/storage-gcs`。
- CMS 固定出口 IP：Cloud Run Direct VPC egress (`all-traffic`) → Cloud NAT → reserved static external IPv4 → Atlas IP Access List。
- 發布：Payload afterChange/afterDelete → 受保護的非同步發布觸發 → Cloud Build → Astro SSG → Firebase Hosting。不得在每次草稿儲存時發布。
- 原始碼：GitHub monorepo + pnpm；GCP 基礎設施：Terraform；CI/CD：GitHub Actions + Cloud Build。

## 前端視覺方向

- **風格 D（已決策）**：首頁為現代 Developer Blog，文章頁結合 Medium 式閱讀與 Documentation 式右側 TOC。
- 完整規範見 `docs/UI_UX_SPEC.md`、`docs/DESIGN_SYSTEM.md`、`docs/PAGE_WIREFRAMES.md`、`docs/FRONTEND_ACCEPTANCE.md`。

## 文件導覽

1. [產品規格](docs/PRD.md)
2. [系統架構與資料流](docs/ARCHITECTURE.md)
3. [內容模型與 API](docs/DATA_AND_API.md)
4. [GCP 部署與網路](docs/DEPLOYMENT.md)
   - [GCP 手動部署操作手冊](docs/GCP_MANUAL_DEPLOYMENT.md)：Console 優先，必要設定與 Optional 分開；沿用 Firebase Hosting，包含繁中介面操作、程式限制與人工發布。gcloud／Terraform 替代方式另見 [CLI 選用附錄](docs/GCP_GCLOUD_REFERENCE.md)。
5. [安全與營運](docs/SECURITY_OPERATIONS.md)
6. [測試與驗收](docs/TEST_PLAN.md)
7. [工作拆解](docs/TASKS.md)
8. [技術決策與未決事項](docs/DECISIONS.md)
9. [UI/UX 規格](docs/UI_UX_SPEC.md)
10. [Design System](docs/DESIGN_SYSTEM.md)
11. [頁面 Wireframes](docs/PAGE_WIREFRAMES.md)
12. [前端驗收標準](docs/FRONTEND_ACCEPTANCE.md)
13. [Codex 執行規範](AGENTS.md)
14. [P00-01 相容性 PoC 紀錄](docs/COMPATIBILITY_POC.md)
15. [線上 CMS 與 Firebase Hosting 操作手冊](docs/ONLINE_RUNBOOK.md)：新增／編輯文章、草稿與媒體管理、前台新版建置、預覽、部署及回復。

## 目前開發進度

CMS、Astro 前台、私有媒體、不可變快照、序列化發布、回滾、加密備份及 Docker CMS 已實作。完整驗收狀態見 [本機 UAT](docs/LOCAL_UAT.md)，啟動與操作見 [本機操作手冊](docs/LOCAL_RUNBOOK.md)。本機完成不代表雲端驗收完成；Atlas M0 複驗獨立列於 P05-04。

## 開發與驗收順序

**先完成本機開發與 UAT，再上雲測試。** Phase 0～4 依序完成本機 PoC、monorepo、CMS／媒體、Astro 前台、發布流程與完整 E2E；通過 P04-06 本機 UAT 後，才開始 Phase 5 的雲端資源、NAT／Atlas／GCS／Cloud Build／Hosting 整合測試，再進 Phase 6 營運與正式交付。

本機使用 Docker MongoDB、Payload 本機持久化媒體與本機 snapshot/build/release；不需雲端帳密。原 P00-02／P00-03 移至 P05-03／P05-05，完整任務對照見 [TASKS](docs/TASKS.md)。正式環境技術棧維持既有決策。

## 本地運行步驟

以下 PowerShell 指令均在專案根目錄執行。先安裝 Node.js 並啟動 Docker Desktop（Linux containers，含 Docker Compose）。尚未安裝 pnpm 時執行一次：

```powershell
npm install --global pnpm@10.34.9
pnpm --version
```

之後直接使用 pnpm，不需 npx。安裝依賴並初始化：

```powershell
pnpm install --frozen-lockfile
pnpm exec node --version
docker compose config --quiet
pnpm db:up
pnpm setup:local
pnpm bootstrap
pnpm seed:local
pnpm build
pnpm publishing:request
pnpm publishing:once
```

專案透過 pnpm devEngines.runtime 取得 Node.js 22.23.4，首次安裝需要網路；實際 runtime 可用上述指令確認。全域 Node 20 可能顯示 workspace engine 提示。

- MongoDB 僅開放 `127.0.0.1:27017`，主機版使用 `asoball_blog_dev`，具名 volume 保留資料。
- `setup:local` 產生被忽略的 `apps/cms/.env` 與 `.local/backup.key`；設定範例見 [環境變數範例](apps/cms/.env.example)。
  - 雲端設定另見 [雲端環境範例](apps/cms/.env.cloud.example)，可設定 `CMS_ENV_FILE=.local/cloud.env`。`pnpm config:check` 只驗證設定，不連線、不輸出秘密。Cloud Run 選 cloud／GCS，支援自訂 Atlas DB；本機預設仍是 local／Docker MongoDB。
- `bootstrap` 建立首位管理者；已有帳號時不修改帳號或密碼。
- `seed:local` 建立明確標示的驗收 fixture（含 12 篇 published、2 篇 draft），不覆寫既有同 slug 文章。

接著開啟三個終端，各自執行一項：

```powershell
# 終端 A：CMS production server
pnpm --filter cms start
```

```powershell
# 終端 B：持續處理發布請求
pnpm publishing:worker
```

```powershell
# 終端 C：提供已發布的靜態版本
pnpm preview:release
```

| 入口         | 網址                               |
| ------------ | ---------------------------------- |
| CMS 後台     | <http://127.0.0.1:3000/admin>      |
| 實際發布站   | <http://127.0.0.1:4330>            |
| CMS 健康檢查 | <http://127.0.0.1:3000/api/health> |

修改 CMS 程式時可用 `pnpm dev:cms` 替代終端 A；兩種 server 不可同時占用 3000。發布、更新已發布文章、取消發布或刪除後，由 worker 重建前台，可在 CMS 的 Deployments 查看狀態。儲存草稿不觸發發布。

`pnpm build` 只建置應用，不啟動 publisher。已有發布操作持有租約時，另一個 publisher 會回報 `busy`；持續 worker 會重試，`publishing:once` 則正常結束但不處理工作。詳見 [發布操作與鎖競爭](docs/LOCAL_RUNBOOK.md#編輯與發布)。

固定前台 fixture 可另用 `pnpm preview:static` 在 <http://127.0.0.1:4322> 預覽；此站供視覺測試，不反映 CMS 編輯結果。停止資料庫使用 `docker compose stop mongodb`，不要使用 `down -v` 清除開發資料。

## Docker 部署指令（本機）

Compose 提供 MongoDB 與 CMS 容器，公開前台仍透過本機發布腳本建置及預覽。以下指令不會部署至雲端。先完成上述 `pnpm install`、`pnpm setup:local` 與 `pnpm db:up`，再執行：

```powershell
docker compose --profile cms build cms
docker compose --profile cms up -d --wait --wait-timeout 120 cms
docker compose ps
```

容器後台位於 <http://127.0.0.1:3001/admin>，使用獨立的 `asoball_blog_docker` 資料庫與 `.local/docker` 媒體目錄。CMS 使用 multi-stage image、非 root 使用者，秘密於 runtime 注入。

在另一個專用 PowerShell 終端初始化 Docker 版管理者：

```powershell
$env:DATABASE_URI = 'mongodb://127.0.0.1:27017/asoball_blog_docker?replicaSet=rs0&directConnection=true'
$env:LOCAL_DATA_DIR = Join-Path (Get-Location) '.local/docker'
$env:BOOTSTRAP_CREDENTIAL_FILE = '.local/docker-admin.json'
pnpm bootstrap
```

此終端若要接續處理 Docker CMS 的發布，可執行：

```powershell
pnpm publishing:request
pnpm publishing:once
pnpm publishing:worker
```

另開終端預覽時，設定相同的 `LOCAL_DATA_DIR` 後執行 `pnpm preview:release`。主機版與 Docker 版的 worker／release 預覽擇一運行，避免預覽埠衝突；結束後關閉專用終端，避免環境變數影響主機版操作。

```powershell
# 查看日誌、重啟或停止，資料會保留
docker compose logs --tail 100 cms
docker compose restart cms
docker compose stop cms
docker compose stop mongodb
```

備份、還原與回滾見 [本機操作手冊](docs/LOCAL_RUNBOOK.md)。

## 雲端 CMS 操作資訊

- 登入入口：[CMS 管理者登入](https://asoball-blog.cloud.run/admin/login)（依目前操作者使用的網址記錄）。若服務入口變更，以 Cloud Run Console 顯示的服務網址及實際 `CMS_URL` 為準，登入路徑固定為 `/admin/login`。
- 首位雲端管理者已透過受信任 bootstrap CLI 建立，操作者已確認可登入。網頁首次註冊 `/api/users/first-register` 刻意停用，回傳 403 時不應解除此保護。
- 初次帳號資訊存於執行 bootstrap 的操作電腦：`.local/cloud-admin.json`，不是 Cloud Run 容器內的檔案。使用本機編輯器開啟，`email` 是初始化時的 `BOOTSTRAP_EMAIL`，`password` 是 CLI 產生的隨機密碼；沒有固定共用密碼。
- 該 JSON 是初次憑證紀錄，不是持續同步的帳號設定。後續在 CMS 的 Users 修改 Email／密碼後，以實際帳號為準，JSON 不會自動更新。已有管理者時重跑 bootstrap 不會重設密碼，亦不覆寫憑證檔；檔案遺失時不要假設重跑即可取回密碼。
- `.local/cloud.env` 保存雲端連線設定；`.local/cloud-admin.json` 保存初次登入憑證，兩者用途不同，均不得提交 Git、貼入聊天或公開文件，也不可放入 Firebase Hosting 發布目錄。請將帳密安全保存於密碼管理工具。

登入後可管理文章、分類、標籤與媒體。現階段雲端文章的公開前台更新仍需依 [GCP 手動部署手冊第 3.9 節](docs/GCP_MANUAL_DEPLOYMENT.md#39-必要操作初始化帳號建置與發布前台) 匯出 published 快照、建置並發布 Firebase Hosting；CMS 儲存／發布成功不代表 `https://asoball.web.app` 已更新。

## 測試帳號資訊

| 環境               | 初次 bootstrap 帳號       | 密碼取得位置                                |
| ------------------ | ------------------------- | ------------------------------------------- |
| 主機 CMS（3000）   | `admin@localhost.invalid` | 本機 `.local/admin.json`                    |
| Docker CMS（3001） | `admin@localhost.invalid` | 依上述指令產生的 `.local/docker-admin.json` |

密碼由 CLI 隨機產生，沒有固定共用密碼。用本機編輯器開啟對應 JSON 查看 email／password；帳號若曾修改，以實際設定為準。兩個環境的資料庫與密碼獨立。已有管理者時重跑 bootstrap 不會重設密碼或重新產生憑證檔。

帳號僅供本機開發；`.env`、憑證 JSON 與備份金鑰均不得提交或貼入公開文件。

## API 文件與入口

完整契約見 [內容模型、權限與 API 文件](docs/DATA_AND_API.md)。主機 base URL 為 `http://127.0.0.1:3000`，Docker 為 `http://127.0.0.1:3001`。

| 方法／路徑                                   | 用途與權限                           |
| -------------------------------------------- | ------------------------------------ |
| `POST /api/users/login`                      | 管理者登入，提交 email／password     |
| `GET /api/posts`                             | 匿名僅可讀 published 文章            |
| `/api/posts`、`/api/categories`、`/api/tags` | Payload REST CRUD；寫入需管理者      |
| `/api/media`                                 | 管理者媒體操作；原始圖片不可匿名取得 |
| `POST /api/publishing/request`               | 管理者觸發發布，支援去重 key         |
| `GET /api/publishing/latest`                 | 管理者查詢最新發布狀態               |
| `GET /api/publishing/:releaseId`             | 管理者依序號查詢發布狀態             |
| `GET /api/health`                            | 非敏感健康檢查                       |

草稿、版本、使用者及發布狀態不開放匿名存取。公開 Astro 僅使用建置快照，不在瀏覽時呼叫 CMS API。

## 測試指令

完成初始化與第一個成功 release 後，依序執行：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:queue
pnpm test:publishing
pnpm test:backup
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:lighthouse
pnpm audit --prod --audit-level=high
```

Lighthouse 需要保持 `pnpm preview:static` 運作。Playwright 可啟動缺少的測試服務；若重用已啟動的 release 預覽，須保持對應 worker 運作。測試結果、核准 baseline 與已知風險見 [本機 UAT](docs/LOCAL_UAT.md)；雲端尚未驗收，下一個任務為 P05-01。

## Git 追蹤範圍

`.gitignore` 排除依賴、建置產物、測試報告、候選截圖、日誌、快取、本機 `.local` 資料、環境秘密、私鑰，以及 Terraform state／plan／實際 tfvars。`next-env.d.ts` 由 Next.js 在 dev／build 時重新產生。

請保留正式應用原始碼、測試程式、文件、`.env.example`、`terraform.tfvars.example`、正式 workspace 的 pnpm lockfile、`.terraform.lock.hcl`、Payload 型別／import map。依專案決策，`poc/` 與 `apps/blog/tests/visual/` 整個目錄不加入 Git，包含 baseline、first-review 與 candidate；新環境執行視覺回歸前需另行取得已核准的 baseline。

首次加入版本控制前可用 `git status --short` 檢查；任意命名的雲端憑證仍應存於被忽略的 `.local/`，不要依賴檔名規則辨識秘密。

## Codex 啟動方式

先閱讀 `AGENTS.md` 和 `docs/DECISIONS.md`，依 `docs/TASKS.md` 的順序，一次完成一個任務；每個任務必須提供變更摘要、測試證據、風險與後續工作。**沒有明確授權，不得建立付費資源、變更 IAM 或部署 production。**

## 非目標（v1）

會員、留言、全文搜尋服務、電子報、多人協作、推薦系統、即時 SSR、排程發文、AI 自動寫作。
