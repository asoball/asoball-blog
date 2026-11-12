# 線上 CMS 與 Firebase Hosting 操作手冊

更新：2026-11-12。適用於已完成基礎部署、可以登入 CMS 的日常操作。操作者回報已完成建置；本文提供操作流程，不代替各項雲端驗收證據。初次資源與管理者設定見 [GCP 手動部署手冊](GCP_MANUAL_DEPLOYMENT.md)。

**自動發布模式**：先依 [P05-08 自動發布設定](CLOUD_AUTO_PUBLISHING.md) 建好 Job／Scheduler／IAM 並通過雲端驗收。啟用後，在 CMS 按 Publish 即會於下一輪排程自動建置部署，至 Deployments 查看 queued／running／succeeded／failed；無須每次執行第 5 節。第 5 節保留為尚未啟用或停用自動化後的人工操作方式；切換前須暫停 Scheduler 並確認無執行中工作／pending，不能與自動部署混用。

## 1. 入口與帳號

| 項目                        | 位置                                                     |
| --------------------------- | -------------------------------------------------------- |
| CMS 登入                    | [管理者登入](https://asoball-blog.cloud.run/admin/login) |
| 公開網站                    | [asoball.web.app](https://asoball.web.app)               |
| Firebase 專案／預設 Site ID | `asoball`／`asoball`，發布前仍須核對 Console             |
| 初次管理者憑證              | 操作電腦的 `.local/cloud-admin.json`                     |
| 雲端操作設定                | 操作電腦的 `.local/cloud.env`                            |

CMS 入口依目前操作者使用的網址記錄；如有變更，以實際 `CMS_URL`／Cloud Run Console 的服務網址加上 `/admin/login` 為準。根路徑 `/` 沒有實作部落格首頁。

用本機編輯器讀取 `cloud-admin.json` 的 `email`／`password` 登入。它只是初次 bootstrap 的憑證紀錄，改密碼後不會同步更新；已有管理者時重跑 bootstrap 不會重設密碼。帳密請保存在密碼管理工具，不提交 Git、不分享憑證檔、不放入 Hosting public 目錄。首位管理者的網頁註冊刻意停用。

## 2. 新增文章

後台使用官方 Payload UI，按鈕可能顯示英文，以下附主要欄位名稱。

1. 登入後選 **Posts → Create New（新增）**。
2. 填入 `title`（必填，最多 160 字元）與 `slug`（必填且唯一）。slug 使用小寫英文字母、數字及連字號，例如 `my-first-post`；不要填完整網址或中文。
3. 填入 `excerpt` 摘要（最多 300 字元），在 `content` 編輯正文。使用 H2／H3 建立章節；需要程式碼時插入 `code` 區塊，填入語言及程式碼。這是 Lexical 編輯器，不是直接貼 Markdown 即自動轉換。
4. 選擇 `category`、`tags` 與 `coverImage`。分類／標籤可先依第 4 節建立，圖片需填替代文字。
5. 視需要設定 `featured`、`seoTitle`（最多 160 字元）、`seoDescription`（最多 300 字元）。`publishedAt` 首次發布時未填會自動設定；手動填日期不是排程發布功能。
6. 選 **Save Draft（儲存草稿）**。專案未開啟 autosave，離開頁面前務必手動儲存。
7. 使用 **Preview（預覽）**，檢查已儲存的內容、圖片與排版。預覽需要管理者登入，不是可公開分享的草稿連結，也不代表 Firebase 已上線。
8. 確認後按 **Publish（發布）**，再依第 5 節部署前台。

**CMS 的 Publish 會將內容設為 published；公開網站只在重新匯出、建置及部署後更新。** 自動化啟用時由雲端工作執行這些步驟，否則按第 5 節人工操作。草稿不會出現在公開快照中。首次發布後 slug 永久鎖定，取消發布也不會解鎖，請在首次發布前確認網址。

## 3. 編輯、取消發布、版本與刪除

| 操作                   | 操作方式                                                        | 公開網站何時改變                                                |
| ---------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| 編輯草稿               | Posts 選文章，修改後 Save Draft，必要時 Preview                 | 仍不公開；日後 Publish 並部署才上線                             |
| 更新已發布文章         | 修改後按 Publish，確認發布成功                                  | 第 5 節完整部署完成後                                           |
| 暫存已發布文章的新修訂 | 若 UI 提供 Save Draft，可先存修訂並預覽；正式更新前再次 Publish | 只存草稿不會更新目前 Hosting；匯出前確認要上線的 published 版本 |
| 取消發布               | 文章頁操作選單選 Unpublish，確認狀態變為 draft                  | 重新匯出、建置及部署後，原文章網址應為 404，列表及 feeds 移除   |
| 還原文章版本           | 進入文章 Versions，檢視並選擇要還原的版本，還原後確認內容及狀態 | 若要公開，確認 Publish 後再部署                                 |
| 刪除文章               | 確認要永久移除後選 Delete，審查確認提示                         | 已發布文章仍須重新部署才從前台移除                              |

文章最多保留 10 個版本，版本紀錄不是完整資料庫備份。需暫時下架時優先使用取消發布；刪除前先確認是否需要保存內容。Firebase 舊版本仍可能保留先前發布產物，取消發布不代表已從所有歷史版本與外部快取永久抹除。

## 4. 分類、標籤、圖片與管理者

- **Categories／Tags**：新增時填 `name`、唯一 `slug`，可填 `description`。修改公開分類／標籤後重新部署前台。刪除前先移除所有文章對它的引用；仍有引用會被拒絕。變更分類／標籤 slug 會影響列表網址，需先確認舊連結影響。
- **Media**：上傳 JPEG、PNG、WebP 或 AVIF，每張最多 5 MiB，影像像素上限 4,000 萬，填寫必填 `alt`（最多 300 字元）。只用有權使用的圖片。原圖保存在 private GCS，公開發布僅帶出已發布文章引用的最佳化圖片，不要將 Bucket 改成公開。
- 刪除媒體前先移除文章封面與正文引用（含草稿），再操作 Delete；引用中的圖片會被保護。更新圖片／alt 後，相關公開內容仍需重新建置部署。
- **Users**：管理者可管理帳號資料與密碼；避免刪除最後一個管理者。登入連續失敗 5 次會鎖定 10 分鐘，先確認帳密再重試。
- **Deployments**：記錄 outbox 工作。自動發布會回寫 buildOperation／buildId、hostingVersion／hostingRelease 與狀態；重新整理查看進度。人工 Firebase 發布不會自動將這些紀錄改成 succeeded；兩種模式都應核對 Firebase 發布歷程與實際網站，不手動修改 outbox 狀態。

## 5. 發布 Firebase Hosting 新版本

每次新增／更新／取消發布／刪除公開文章，或修改公開分類、標籤、圖片，都走完整流程。前台程式或樣式變更也需重新建置及部署；CMS 程式變更則另外走 Cloud Build／Cloud Run，不由本節更新。

### 5.1 準備操作環境與登入

同一時間只允許一位操作者發布，停止其他部署流程，匯出到發布期間暫停內容編輯。開啟乾淨的 PowerShell，不混用本機 DATABASE_URI 等舊環境變數。

```powershell
Set-Location D:\Code\asoball-blog
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
pnpm exec node --version
firebase --version
firebase login
firebase projects:list
$deployProject = 'asoball'
firebase hosting:sites:list --project $deployProject
if ($LASTEXITCODE -ne 0) { throw 'Verify Firebase access before continuing.' }
```

若尚未安裝 CLI，先執行 `npm install --global firebase-tools@15.35.0`。已登入且授權有效可沿用；不需要重跑 `firebase init`，repo 已有 `firebase.json`。核對預設站是 `asoball`，不是其他專案或額外 site。

操作機還需要：

1. `.local/cloud.env` 指向與線上 CMS 相同的 Atlas DB、private GCS 與正式 PAYLOAD_SECRET，設定 `DEPLOYMENT_ENV=cloud`、`MEDIA_STORAGE=gcs`、`SITE_URL=https://asoball.web.app`。沿用既有檔案，日常發布不用重跑 bootstrap 或 seed。
2. Atlas Network Access 暫時允許操作機目前公網 IPv4 `/32`，設定到期時間；Cloud Run 的 NAT allowlist 不會涵蓋本機電腦。
3. 有權讀取媒體 Bucket 的 GCS ADC。已有可用身分可沿用；尚未配置或授權失效時，在已安裝 Google Cloud CLI 的操作機執行 `gcloud auth application-default login`。Firebase login 不等於 ADC，也不建議下載長期 SA JSON key。詳見 [ADC 附錄](GCP_GCLOUD_REFERENCE.md)。

```powershell
pnpm exec node --env-file=.local/cloud.env --import tsx scripts/check-config.ts
if ($LASTEXITCODE -ne 0) { throw 'Invalid cloud configuration.' }
```

### 5.2 封存舊產物、匯出快照與建置

發布目錄固定為 repo 內 `.local/cloud-candidate/site`。若上次產物存在，先在檔案總管將整個 `.local/cloud-candidate` 重新命名為未使用的名稱，例如 `cloud-candidate-archive-20261112-001`，保留舊產物；**不要合併新舊 site**，避免舊文章殘留。封存僅處理本機產物，不影響線上版本。

在同一個 PowerShell 依序執行；任何錯誤都停止，不部署半成品：

```powershell
$manualRelease = 'manual-' + (Get-Date -Format 'yyyyMMdd-HHmmssfff')
$env:BLOG_OUT_DIR = Join-Path (Get-Location) '.local/cloud-candidate/site'
$env:SITE_URL = 'https://asoball.web.app'
if (Test-Path -LiteralPath '.local/cloud-candidate') { throw 'Archive the previous cloud-candidate directory first.' }

pnpm exec node --env-file=.local/cloud.env --import tsx scripts/export-snapshot.ts $manualRelease
if ($LASTEXITCODE -ne 0) { throw 'Snapshot export failed; stop deployment.' }
$snapshotDirectory = Join-Path (Get-Location) ".local/snapshots/$manualRelease"
$env:CONTENT_SNAPSHOT = Join-Path $snapshotDirectory 'snapshot.json'

pnpm --filter blog build
if ($LASTEXITCODE -ne 0) { throw 'Astro build failed; stop deployment.' }
Copy-Item -LiteralPath (Join-Path $snapshotDirectory 'media') -Destination $env:BLOG_OUT_DIR -Recurse -ErrorAction Stop
if (-not (Test-Path -LiteralPath (Join-Path $env:BLOG_OUT_DIR 'index.html'))) { throw 'Missing Hosting index.html.' }
pnpm exec tsx scripts/seo-check.ts $env:BLOG_OUT_DIR
if ($LASTEXITCODE -ne 0) { throw 'SEO validation failed; stop deployment.' }
Get-FileHash -LiteralPath $env:CONTENT_SNAPSHOT -Algorithm SHA256
git rev-parse HEAD
```

記錄 release ID、快照 SHA256、Git commit，以及是否有未提交的前台修改。匯出成功會顯示 published 文章數；若與預期不符，先檢查狀態及 DB，不繼續發布。不要直接部署未指定快照的 fixture build，也不要將 public 指向整個 `.local`。

### 5.3 本機預覽與發布前審查

```powershell
firebase emulators:start --only hosting --project $deployProject
```

開啟輸出的本機網址（通常 `http://127.0.0.1:5000`），檢查：

- 新增／更新文章的正文、程式碼、圖片與行動版排版。
- 首頁、分類、標籤及相關列表；取消發布／刪除文章已移除，舊網址為 404。
- `/rss.xml`、`/sitemap-index.xml` 與 `/robots.txt`；canonical／feed 網址使用 `https://asoball.web.app`。
- 草稿沒有出現，沒有測試 fixture、私有原圖或憑證檔。

通過後 Ctrl+C 結束預覽。本機預覽是人工審查步驟，不是遠端部署 dry-run；預覽失敗時不可繼續。

### 5.4 正式部署

先在 Firebase Console → Hosting 記錄上一個可回復版本，再確認本次 project、site、release ID、快照與產物。以下命令會實際更新線上網站，人工確認完成後才執行：

```powershell
if (-not $manualRelease) { throw 'Use the release ID verified in this session.' }
firebase deploy --only hosting --project $deployProject --message "Manual release $manualRelease"
if ($LASTEXITCODE -ne 0) { throw 'Hosting deployment failed; inspect Firebase release history.' }
```

必須沿用上述操作工作階段，不開新終端直接複製最後一段。若中斷後接手，先找回並核對實際 release ID／產物，重新預覽。`firebase deploy` 不會執行 Astro build，也不會更新 CMS 容器或 Atlas 內容。

### 5.5 線上驗收與收尾

1. 到 Firebase Console → Hosting 核對發布時間與 `Manual release ...` 訊息。
2. 開啟 [線上網站](https://asoball.web.app)，重做第 5.3 節檢查，確認 HTTPS、文章、圖片、列表、feeds、canonical 與 404。
3. 記錄操作者、發布時間、project／site、release ID、Git commit、快照 SHA256、驗收結果及上一可用 Hosting 版本。
4. 移除 Atlas 中本次操作機的臨時 `/32`，保留 Cloud NAT 固定 IP；關閉專用終端。保留必要的快照與封存產物，依既定保留政策處理。

## 6. 發布失敗與回復

| 情況                                                   | 處理方式                                                                          |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Directory `.local/cloud-candidate/site` does not exist | 回到第 5.2 節完成快照及建置，確認在 repo 根目錄執行；不要只建立空目錄             |
| Atlas timeout                                          | 檢查操作機 `/32`、URI、cluster 狀態；本機匯出不會經 Cloud Run NAT                 |
| GCS 403／ADC 錯誤                                      | 檢查操作機 ADC 身分與 Bucket 讀取權限；不開放 Bucket 匿名存取                     |
| Firebase 找不到專案／無權限                            | 核對登入帳號、`--project asoball`、Hosting 部署權限與 Site ID                     |
| slug 修改被拒絕                                        | 已發布 slug 被鎖定；保留原 slug，必要時另行規劃新文章與舊網址處理                 |
| CMS 發布成功但前台沒更新                               | 確認完成第 5 節，部署的是本次快照建置產物；核對 Firebase 發布歷程                 |
| 部署中斷或失敗                                         | 到 Console 確認實際線上版本，修正後重新驗證再發布；不要假設成功或舊版一定仍在服務 |

若新版已上線且有問題，Firebase Console → Hosting → 發布歷程，選**已驗證的前一版本**執行 Rollback（回復），完成後重新驗收。首次發布沒有舊版可回復。這只回復前台檔案，不回復 CMS 文章、Atlas、GCS 原圖或 Cloud Run；下一次匯出仍會使用當下 published 內容，須同步修正 CMS。不要用本機 `pnpm rollback` 回復雲端，也不要對雲端執行本機 publisher／backup 工具。

## 7. 權限、費用與參考

日常內容發布不需建立新資源或重建 CMS；仍會產生既有 GCS 操作／資料傳輸、Hosting 儲存／流量等用量，NAT／IP 等既有資源也可能持續計費。本機快照及憑證需保護，Hosting 回復不是完整備份；Atlas／GCS 備份另依維運政策執行。

官方參照：[Firebase CLI](https://firebase.google.com/docs/cli)、[Hosting 預覽與部署](https://firebase.google.com/docs/hosting/test-preview-deploy)、[GCS ADC 設定](https://docs.cloud.google.com/docs/authentication/provide-credentials-adc)。
