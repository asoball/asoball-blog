# 本機操作手冊

本機使用 Docker MongoDB replica set，不需要 Atlas、GCP 或 Firebase 帳密。所有命令於專案根目錄執行；pnpm 10.34.9 透過 devEngines 使用 Node 22.23.4。主機全域 Node 20 的 workspace engine 警告不代表腳本使用 Node 20；可用 `pnpm exec node --version` 確認。

## 初次啟動

```powershell
pnpm install --frozen-lockfile
pnpm db:up
pnpm setup:local
pnpm bootstrap
pnpm seed:local
pnpm build
pnpm publishing:request
pnpm publishing:once
```

`setup:local` 產生被忽略的 `apps/cms/.env` 與 `.local/backup.key`；管理者憑證位於 `.local/admin.json`。不要提交或貼出上述檔案。Seed 為明確標示的測試資料，不代表作者真實文章；既有同 slug 內容不覆寫。

分別於三個終端執行：

```powershell
pnpm --filter cms start
pnpm publishing:worker
pnpm preview:release
```

- 管理後台：http://127.0.0.1:3000/admin
- 真實本機發布站：http://127.0.0.1:4330
- 固定 fixture 視覺測試站：`pnpm preview:static`，http://127.0.0.1:4322
- 編輯程式時可用 `pnpm dev:cms` 替代 CMS production start；兩者不能同時占用 3000。

MongoDB 只綁定 127.0.0.1:27017，具名 volume 保留資料。使用 `docker compose stop mongodb` 停止；不要使用 `down -v`。

## 編輯與發布

官方 Payload 後台支援文章、分類、標籤、媒體與 Deployments 紀錄。儲存草稿不觸發發布；正式發布、更新已發布文章、取消發布、刪除已發布文章會寫入同一交易的 outbox。需保持 worker 執行，等待 Deployments 顯示 succeeded。私有原圖僅管理者可讀；發布產物只複製已發布文章引用的最佳化圖片。

手動重建：`pnpm publishing:request`。worker 會去重、合併較舊請求、序列化建置並最多重試三次；失敗時 `.local/active.json` 保持舊版本。修正問題後再送新請求。`.local/releases/` 保存 manifest、不可變 snapshot 與完整靜態產物。不要手動編輯其中檔案。

`pnpm build` 只建置 Astro／CMS，不執行 publisher。若已有 worker 或其他發布操作持有租約，另一個 publisher 會輸出 `{"state":"busy"}`，不搶鎖或變更發布指標。持續 worker 每秒重試；`pnpm publishing:once` 在 busy 時正常結束但不處理工作，請交由既有 worker，或待其結束後重跑。不要為解除 busy 手動刪除有效租約。

## 回滾

停止 worker，從 `.local/releases/` 選擇已驗證的 release ID：

```powershell
pnpm rollback release-0000000001-f1
```

以實際 ID 替換範例。回滾驗證產物 SHA256、取得發布租約與檔案鎖，並增加序號使舊工作失效；不會回滾資料庫內容。若行程中斷留下 activation.lock，確認原行程已死亡後執行 `pnpm rollback --recover-dead-lock`；工具只允許同主機且 PID 已不存在的鎖。無法驗證的鎖須人工調查，不可盲目刪除。

## 加密備份與還原

先停止 CMS 與 worker，保持 MongoDB 運作，確保 DB 與媒體沒有寫入。`--offline` 表示操作者已完成此步驟，工具不會自動停止服務。

```powershell
pnpm backup create asoball_blog_dev --offline
pnpm backup restore .local/backups/<實際備份目錄>
```

備份包含 AES-256-GCM 加密的 mongodump、媒體與 manifest；金鑰 `.local/backup.key` 必須另行安全保存，遺失即無法還原。還原只允許空的 `asoball_blog_restore`，媒體寫入新的 `.local/restored/` 目錄；不 drop、不覆蓋既有 DB。所有檔案驗證解密成功後才匯入。還原後先以該 DB／媒體目錄進行隔離驗證，再規劃切換；不能直接沿用缺少對應 releases 的 active 指標。

## Docker CMS 驗證

```powershell
docker compose --profile cms build cms
docker compose --profile cms up -d --wait cms
```

容器後台 http://127.0.0.1:3001/admin 使用獨立 `asoball_blog_docker` DB 與 `.local/docker` 媒體目錄；不與主機 DB 混用。容器以 node 非 root 使用者執行。秘密只在 runtime 注入，不寫入 image。

備份 Docker CMS 時先停止該容器，將 `LOCAL_DATA_DIR` 設成專案 `.local/docker` 的絕對路徑，再對 `asoball_blog_docker` 執行備份；主機版預設則是 `.local`。不要混配 DB 與媒體目錄。

## 回歸測試

完成初次啟動後，依序執行，避免同時更新 Astro optimizer／snapshot：

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

Playwright 自動啟動缺少的 production CMS、fixture 預覽及 worker／release 預覽；執行前必須已有初次成功 release。HTML 報告在 `playwright-report/`，失敗 trace 在 `test-results/`，Lighthouse 在 `.local/lighthouse/`。Windows baseline 已獲使用者核准；其他作業系統需另行人工核准，不能自動產生 baseline 當作通過。

雲端 Terraform 僅本機 fmt/validate，cloud adapter 僅契約測試。Phase 5 才驗證真實 M0、NAT、GCS、Cloud Build、Hosting、WIF 與費用。
