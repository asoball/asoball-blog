# P05-08：CMS → Firebase Hosting 自動發布設定與維運

更新：2026-11-12。程式與本機契約／整合測試完成後，仍須由操作者完成本文的 Console 建置及真實雲端驗收。本文不代表線上自動化已啟用，不執行正式部署。既有 CMS、Atlas、媒體 Bucket、default VPC／NAT 與 Firebase `asoball` 可沿用。

## 1. 完成後的行為與架構

```text
CMS Publish／更新／Unpublish／刪除
  → 同一 MongoDB 交易寫入 outbox
Cloud Scheduler 每分鐘啟動 Cloud Run Job
  → Job 取得租約，選最新待發布工作，匯出 published 快照與引用的最佳化圖片
  → 寫入 private snapshot Bucket（不可覆寫）
  → 呼叫內容專用 Cloud Build trigger（固定 Git commit）
  → Astro 建置＋SEO／私有資料掃描 → private candidate Bucket
  → Job 核對來源、快照、逐檔 SHA256，再建立 Firebase FINALIZED version
  → 再次比對最新序號，取得持久化 activation permit
  → 建立 Firebase live release → 回寫 CMS Deployments succeeded
```

不需每次在操作電腦匯出或執行 firebase deploy。開始處理最多約等候一個排程間隔，另加匯出／建置／部署時間；不是即時顯示。儲存草稿不新增發布工作；分類／標籤變更、公開引用圖片變更仍會要求重建。初次啟用會處理 DB 中最新尚可執行的佇列工作，請先審查目前 published 內容。

CMS 不在 afterChange hook 中直接呼叫雲端服務；hook 只寫交易內 outbox。輪詢只會看到已提交工作，因此不會因交易回滾、CMS 縮到零或 HTTP 請求結束而遺失事件。每次 Job 最多處理一個最新工作；建置期間新增工作會在下一輪處理，舊候選在啟用前若已落後，會標示 superseded。

## 2. 先審查部署計畫與成本

先填寫下表並確認權限、成本、commit，再進行第 3 節。Console 無跨產品通用 dry-run；可另用以下離線 plan 驗證變數格式，不連雲端、不輸出 URI／密碼：

```powershell
Set-Location D:\Code\asoball-blog
# 用編輯器從 infrastructure/publisher/.env.example 建立被忽略的 .local/cloud-publisher.env
pnpm exec node --env-file=.local/cloud-publisher.env --import tsx scripts/cloud-publisher.ts --plan
```

| 項目               | 填寫內容                                                                                |
| ------------------ | --------------------------------------------------------------------------------------- |
| Project／Region    | `asoball`／現有 CMS Region（如 `asia-east1`；本流程不用 global trigger）                |
| Hosting Site／URL  | `asoball`／`https://asoball.web.app`                                                    |
| 媒體 Bucket        | 既有 private GCS Bucket                                                                 |
| 新快照 Bucket      | 例如 `PROJECT-blog-snapshots`，全域唯一                                                 |
| 新候選 Bucket      | 例如 `PROJECT-blog-candidates`，全域唯一，與媒體／快照分開                              |
| Job／runtime SA    | `asoball-blog-publisher`／`asoball-blog-publisher@PROJECT.iam.gserviceaccount.com`      |
| 內容建置 SA        | `asoball-blog-content-build@PROJECT.iam.gserviceaccount.com`                            |
| Scheduler／呼叫 SA | `asoball-blog-publisher-tick`／`asoball-blog-scheduler@PROJECT.iam.gserviceaccount.com` |
| 內容 trigger ID    | 建立後記錄實際 UUID，勿填 CMS image trigger                                             |
| 固定來源 SHA       | 經審核並已推送 GitHub 的完整 40 位小寫 commit SHA                                       |
| Job image          | publisher image 的完整 immutable `@sha256:...`                                          |
| 網路／DB           | 同 CMS 的 default VPC、同區 subnet、all-traffic、NAT、Atlas DB                          |

新增 **Cloud Scheduler、Cloud Run Job、兩個 GCS Bucket、publisher image 與內容 Cloud Build**，都可能計費。每分鐘執行約 1,440 次／日，即使無文章變更也有 Job 啟動、MongoDB 查詢與日誌用量；可改為每 5 分鐘以降低用量，但上線等待時間相應增加。只有有待處理工作時才建置 Astro。暫存產物與失敗候選不自動刪除，須另訂保留／生命週期政策並人工審查刪除條件。不要為此建立長期 SA 金鑰、額外 NAT 或公開 Bucket。

## 3. 必須手動建立／設定的項目（Console 優先）

### 3.1 API 與私有 Bucket

1. GCP「API 和服務」→「程式庫」，確認 Cloud Run、Cloud Build、Firebase Hosting、Cloud Storage、Secret Manager、Logging 已啟用；新增啟用 **Cloud Scheduler API**。
2. 「Cloud Storage」→「值區」→「建立」，各建一個快照與候選 Bucket；Region 同現有服務、Standard、統一值區層級存取（UBLA）、禁止公開存取。不要選媒體 Bucket 重用。
3. 物件版本管理非必要，不鎖定保留政策；記錄虛刪除預設與費用。快照與候選使用 create-only 寫入，程式不刪除 GCS 物件。

### 3.2 三個執行身分與 IAM

「IAM 與管理」→「服務帳戶」，建立上述 Job、內容 build、Scheduler 三個 SA，不建立 JSON key。只授予下列必要範圍：

| 身分          | 權限／範圍                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| Job SA        | 媒體 Bucket：Storage 物件檢視者 `roles/storage.objectViewer`                                                  |
| Job SA        | 快照 Bucket：Storage 物件建立者 `roles/storage.objectCreator`                                                 |
| Job SA        | 候選 Bucket：Storage 物件檢視者 `roles/storage.objectViewer`                                                  |
| Job SA        | 僅 database-uri secret：Secret Manager 密鑰存取者 `roles/secretmanager.secretAccessor`                        |
| Job SA        | Firebase 專案：Firebase Hosting 管理員 `roles/firebasehosting.admin`；只發布至程式設定的 site                 |
| Job SA        | 內容 build SA 上：服務帳戶使用者 `roles/iam.serviceAccountUser`，允許 actAs                                   |
| Job SA        | 專案自訂角色：`cloudbuild.builds.create`、`cloudbuild.builds.get`；若組織要求，補 `serviceusage.services.use` |
| 內容 build SA | 快照 Bucket：Storage 物件檢視者；候選 Bucket：Storage 物件建立者                                              |
| 內容 build SA | 專案：記錄檔寫入者 `roles/logging.logWriter`                                                                  |
| Scheduler SA  | **Job 建好後僅對該 Job**：Cloud Run 叫用者 `roles/run.invoker`                                                |

自訂角色操作：「IAM 與管理」→「角色」→「建立角色」→「新增權限」，加入表列權限；建立後到 IAM 將此角色授予 Job SA。`cloudbuild.builds.create` 有建立建置的能力，不等於只可執行單一 trigger；因此 Job SA 不可 actAs CMS build／其他高權限 SA，也不可授予 Owner／Editor。不要授予內容 build SA Atlas URI、媒體原圖或 Firebase live 發布權限。

GitHub 來源沿用已建立的 Cloud Build 連線授權；若使用第 2 代 repository 且建置提示 `accessReadToken` 權限不足，僅在對應 connection／repository 授予內容 build SA `roles/cloudbuild.readTokenAccessor`，不授予原始碼寫入 token。使用同專案 SA；跨專案身分另依官方限制設定，不直接套用本表。

這些工作全部在 GCP 內，以服務身分取得短期憑證（ADC），**不需要 GitHub WIF**。若未來改從 GitHub Actions 執行，再另外設定 WIF；不產生長期 key 來取代它。Cloud Scheduler 的 Google 管理服務代理需保留官方 `roles/cloudscheduler.serviceAgent`，不要把此角色授予自建的 Scheduler SA。

### 3.3 內容專用 Cloud Build trigger

1. 提交並推送本次程式、lockfile 與 YAML；選擇受保護、已審核的完整 commit。
2. Cloud Build →「觸發條件」→「建立觸發條件」，例如 `asoball-blog-content`，Region 同 Job，來源選現有 GitHub 存放區。
3. 事件選 **手動叫用（Manual invocation）**；它由 Job 呼叫 API，不靠 Git push。設定檔類型選「Cloud Build 設定檔（YAML 或 JSON）」、位置「存放區」、路徑 **`infrastructure/cloudbuild/blog.yaml`**。
4. 選專用內容 build SA。**此內容 trigger 不要求每次人工核准**，否則文章無法自動上線。現有 CMS image trigger 的人工核准保持不變。
5. 替代變數加入 `_SOURCE_SHA`、`_RELEASE_ID`、`_SNAPSHOT_URI`、`_SNAPSHOT_SHA256`、`_CANDIDATE_BUCKET`、`_SITE_URL`。初始填待設定的占位值；Job 每次會以已驗證的固定 commit／release／快照摘要覆寫。不要放入 DB URI 或任何 secret，不手動執行占位值 build。
6. 記錄實際 trigger ID。此 build 只建置並儲存候選，不會自行啟用 Firebase；發布權限保留在 Job。

建置會核對 `_SOURCE_SHA` 與 Cloud Build 的 `COMMIT_SHA` 相同；下載快照與圖片時驗證 SHA256，完成後逐檔計算 candidate manifest，manifest 最後才以 create-only 方式寫入。Job 只接受與本次 release／來源／快照完全相符的候選。

### 3.4 建置 publisher image 與更新 CMS

1. 另建 **image-only** trigger（例如 `asoball-blog-publisher-image`），來源與現有 CMS trigger 相同，設定檔選 **`infrastructure/cloudbuild/publisher.yaml`**；保留人工核准。
2. 選有 Registry repository 寫入與 Logging 權限的 image build SA（可沿用已配置的 CMS image build SA）。設定 `_REGION`、`_REPOSITORY` 為既有 Registry 實際值。
3. 執行審核過的 commit，核准後於 Artifact Registry 找到 `publisher` 映像，複製該 commit 的完整 `@sha256:...`。
4. CMS 沿用現有 `cms.yaml` 建置／候選 revision 流程，更新至同一版程式，核對後切換流量，讓 Deployments 顯示新增的 build／Hosting 欄位。CMS `PUBLISHING_ENABLED` 必須未設定或為 `true`。

publisher image 非 root、不內含 `.env`、秘密或前台 fixture；內含執行 Job 所需程式。Deployments 僅新增四個選用唯讀文字欄位，不改既有內容／索引；本機 Docker 回歸後仍須在 Atlas 複驗。Job 不啟動 Payload，也不需要 PAYLOAD_SECRET。

### 3.5 建立 Cloud Run Job（不是 Service）

Cloud Run →「工作」（Jobs）→「建立工作」，審查摘要再建立：

| 畫面項目           | 設定                                                                           |
| ------------------ | ------------------------------------------------------------------------------ |
| 名稱／Region       | 計畫表的 Job 名稱／CMS 同區域                                                  |
| 映像               | 上一步 publisher 的完整 immutable digest                                       |
| 工作數／平行處理數 | `1`／`1`；多個 execution 重疊由 DB 租約拒絕，不能只靠此設定當全域鎖            |
| CPU／記憶體        | 初始 1 vCPU／2 GiB，按實測調整                                                 |
| 工作逾時           | 1800 秒；Cloud Build 1200 秒，程式最多等建置 22 分鐘                           |
| 失敗重試次數       | `0`，由 outbox＋下一輪 Scheduler 控制，工作最多 3 次嘗試                       |
| 服務帳戶           | 專用 Job SA                                                                    |
| 網路               | Direct VPC egress、既有 default VPC、CMS 同區域 subnet、**所有流量轉送至 VPC** |
| 密鑰參照環境變數   | `DATABASE_URI` → 與 CMS 相同 DB 的 secret 明確版本                             |
| 初次容器指令／引數 | 指令 `pnpm`；引數分別為 `cloud:publish`、`--plan`                              |

一般環境變數如下，不填 `PAYLOAD_SECRET`，不設定 `GOOGLE_APPLICATION_CREDENTIALS`：

| 名稱                                              | 值                                                       |
| ------------------------------------------------- | -------------------------------------------------------- |
| `MEDIA_STORAGE`／`GCS_BUCKET`                     | `gcs`／既有媒體 Bucket 名稱                              |
| `CLOUD_PROJECT_ID`／`CLOUD_REGION`                | `asoball`／實際 Region                                   |
| `CLOUD_BUILD_TRIGGER`                             | 內容 trigger 實際 ID                                     |
| `CLOUD_SOURCE_SHA`                                | 審核過的完整 40 位 commit SHA，與本次 Job image 程式一致 |
| `CLOUD_SNAPSHOT_BUCKET`／`CLOUD_CANDIDATE_BUCKET` | 新建的兩個 private Bucket 名稱，不含 `gs://`             |
| `FIREBASE_SITE_ID`／`SITE_URL`                    | `asoball`／`https://asoball.web.app`                     |
| `CLOUD_PUBLISH_ENABLED`                           | 首次 `false`                                             |

Atlas 既有 NAT `/32` 可沿用，但必須確認 NAT 包含 Job 所用 subnet，Job 的 DB user 能讀取內容並操作 publish_state／publish_jobs。若環境額外設定 `DATABASE_NAME`，必須與 URI 相同。不要照抄本機 MongoDB 參數。

先執行一次 plan Job，日誌確認 `networkCalls:false`、project、site、trigger、commit 與 Bucket。**plan 只驗證格式，不能驗證 IAM／網路／Bucket 實際存在。** 確認無誤後編輯 Job：移除 `--plan` 引數，保留 `cloud:publish`，將 `CLOUD_PUBLISH_ENABLED=true`。這會允許下一次執行處理真實發布，先確認內容與回復版本再按「執行」。

### 3.6 Scheduler 自動啟動

1. 在 Job 的「權限」將 `roles/run.invoker` 授予 Scheduler SA。
2. Job →「觸發條件」→「新增 Scheduler 觸發條件」；若介面不同，從 Cloud Scheduler →「建立工作」進入。
3. 頻率 `* * * * *`，時區 `Asia/Taipei`。HTTP 目標設：

   ```text
   POST https://run.googleapis.com/v2/projects/asoball/locations/REGION/jobs/JOB_NAME:run
   ```

4. Body `{}`、Content-Type `application/json`，驗證選 **OAuth**（Google API，不選 OIDC），服務帳戶選 Scheduler SA，scope `https://www.googleapis.com/auth/cloud-platform`。
5. 若介面支援，先以暫停狀態保留，待下一節的手動 Job 驗收通過再啟用。HTTP 成功只代表 Job 已啟動，不代表 Firebase 已更新；應看 execution 與 Deployments。

## 4. 啟用與真實雲端驗收清單

先暫停所有人工 Firebase deploy 與其他 publisher，不與自動發布同時操作。手動執行一次 Job 通過後，啟用 Scheduler，再依序測試：

- [ ] plan 日誌不含秘密；runtime SA／兩個新 Bucket／來源 commit／site 正確。
- [ ] 新增草稿，不新增發布工作，前台不出現；草稿圖片與原圖不可匿名取得。
- [ ] CMS Publish 一篇可辨識測試文章，等待 queued → running → succeeded；記錄 buildOperation／buildId、hostingVersion／hostingRelease。
- [ ] `https://asoball.web.app` 的文章、圖片、分類／標籤、RSS、sitemap、canonical 正確。
- [ ] 更新、取消發布、刪除文章皆自動更新，取消發布／刪除後舊文章網址為 404。
- [ ] 連續兩次發布，舊候選不可在新版本之後覆蓋；重複 execution 只允許一個持有租約。
- [ ] 受控建置失敗保留舊站，最多三次嘗試；修正後用第 5 節重新排隊。
- [ ] 驗證 private 快照／候選不可匿名取得，內容 build SA 無 Atlas secret／媒體原圖／Firebase release 權限。
- [ ] 記錄 Job 實際 NAT 出口、Atlas 連線數、執行時間、記憶體與費用；失敗／blocked 告警收件可收到通知。
- [ ] Scheduler 在 CMS 沒有請求、縮到零後仍能處理先前已提交 outbox。

發布成功只改前台版本，不改 Atlas 內容。完整 Hosting／Run 回滾演練另屬 P05-09。真實雲端執行前，TASKS 中 P05-08 保持未勾選；本機測試不可代替以上驗收。

## 5. 日常操作與重試

啟用後文章操作仍使用 [線上手冊](ONLINE_RUNBOOK.md) 的 CMS 部分；Publish 後到 **Deployments** 重新整理查看狀態。Job 失敗三次後停止，修正原因再建立新發布請求，不直接修改 DB 的 attempts／租約。

管理者可在 CMS 同源頁面開啟瀏覽器開發者工具 Console 執行以下請求，以既有登入 cookie 排入新工作（不帶帳密、不解除 CSRF 檢查）：

```javascript
const response = await fetch("/api/publishing/request", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ key: `retry-${crypto.randomUUID()}` }),
});
console.log(response.status, await response.json());
```

預期 HTTP 202，再由下一輪排程處理。API 僅允許管理者與同源操作。也可重新 Publish 一次產生新事件。

程式／樣式更新時，仍需審核新 commit，更新 Job image digest 與 `CLOUD_SOURCE_SHA`；不要設為 main／latest。先暫停排程、等待舊 execution 完成及確認無 pending，再更新、手動驗證後恢復排程。CMS image 與內容建置使用不同 trigger。

## 6. 結果不明、對帳與回復

Firebase release POST 不自動重試。如果回應遺失或程式在啟用前後中斷，DB 的 cloudPending 會阻擋所有後續 publisher；Deployments 可見 `ACTIVATION_PENDING_RECONCILIATION`。下一輪在原租約失效後會查最新 Firebase release，若 version／message 與 pending 完全相符就自動完成 DB 記錄；查不到相符結果時會持續 blocked，**不推測失敗、不清鎖重發**。

1. 暫停 Scheduler，確認所有 Job execution、其他自動／人工發布皆已結束；必要時先在 Console 停止原 execution，等待其終止。
2. 檢查 Job 日誌、Firebase Hosting 發布歷程與 live 內容，記錄 pending 的 fence／seq／hostingVersion。保持原物件與 DB 不變。
3. 對帳 CLI 需要可讀 Atlas、Firebase 的操作機身分、臨時 Atlas `/32` 及 `.local/cloud-publisher.env`，先跑離線 plan：

   ```powershell
   pnpm exec node --env-file=.local/cloud-publisher.env --import tsx scripts/cloud-reconcile.ts --plan
   # 下列命令會查詢雲端；若最新 release 相符，會補寫 DB 成功紀錄
   pnpm exec node --env-file=.local/cloud-publisher.env --import tsx scripts/cloud-reconcile.ts
   ```

4. 若仍 blocked，只有在**確認原請求已無可能繼續生效，且該版本未上線**後，才可將本機操作設定的 `CLOUD_PUBLISH_ENABLED=false`，使用確切 pending fence 明確確認未生效。例如 fence 是 123 時：

   ```powershell
   pnpm exec node --env-file=.local/cloud-publisher.env --import tsx scripts/cloud-reconcile.ts --plan --fence=123
   pnpm exec node --env-file=.local/cloud-publisher.env --import tsx scripts/cloud-reconcile.ts --confirm-no-inflight --confirm-not-applied --fence=123
   ```

   此步驟會寫入人工確認紀錄、將該工作標示 failed 並清除該 fence 的 pending，不會直接發布。**最新 release 不相符不代表原請求絕不會延遲完成；無法確定時保持 blocked，繼續調查。** 後續由管理者建立新發布請求，再恢復 Scheduler。

需回復 Hosting 時先暫停 Scheduler，等待／終止 execution 並處理 pending，再從 Firebase Console 回復已驗證前版。同步修正 CMS published 內容後再恢復自動化，否則下次變更仍會重新發布當下資料。不要用本機 rollback 回復雲端，不與人工 deploy 同時進行。

## 7. 程式與測試對照

| 檔案                                                                              | 用途                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `scripts/cloud-publisher.ts`                                                      | Job 主程式、快照、Cloud Build、候選驗證與 Hosting staging    |
| `packages/publishing/src/cloud-worker.ts`                                         | 交易佇列、心跳、序號、啟用保護與對帳                         |
| `packages/publishing/src/firebase.ts`                                             | gzip／SHA256、populateFiles、上傳、FINALIZED 與 live release |
| `packages/publishing/src/cloud-artifacts.ts`                                      | 不可變產物、來源及逐檔摘要檢查、拒絕 traversal／symlink      |
| `infrastructure/cloudbuild/blog.yaml`                                             | 內容 candidate 建置，無 Firebase live 權限                   |
| `infrastructure/cloudbuild/publisher.yaml`、`infrastructure/publisher/Dockerfile` | Job image 建置                                               |
| `scripts/cloud-reconcile.ts`                                                      | 未知部署結果的對帳及受控人工復原                             |

本機驗證：`pnpm test`、`pnpm test:cloud-publishing`（真實 Docker MongoDB／CMS／Astro，模擬 Google／Firebase API）、既有 integration／queue／publishing 回歸、lint／typecheck／build。無遠端 IAM、Scheduler、GCS、Cloud Build 或 Hosting 實際變更。

2026-11-12 本機執行證據：

| 命令／檢查                                                                               | 結果                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`、`pnpm typecheck`                                                            | PASS；Astro 0 errors／warnings／hints                                                                                               |
| `pnpm test`                                                                              | PASS，13 個測試檔、38 項測試                                                                                                        |
| `pnpm test:integration`、`pnpm test:queue`、`pnpm test:publishing`                       | PASS，既有 CMS／交易／媒體／序列化／回滾回歸                                                                                        |
| `pnpm test:cloud-publishing`                                                             | PASS，真實本機 DB／CMS hook／Astro，加模擬 Hosting gzip 上傳；發布、更新、下架、刪除、草稿隔離、並行、租約失效、重試與 pending 對帳 |
| `pnpm build`                                                                             | PASS，Astro 與 CMS；本機日誌 `.local/p05-08-build.log`                                                                              |
| `docker build -f infrastructure/publisher/Dockerfile -t asoball-blog-publisher:p05-08 .` | PASS，image USER 為 node；日誌 `.local/p05-08-image.log`                                                                            |
| 容器以範例 env 執行 `pnpm cloud:publish --plan`                                          | PASS，enabled=false／networkCalls=false，無需雲端帳密                                                                               |
| 新 YAML、文件連結、PowerShell 語法與格式                                                 | PASS                                                                                                                                |
| 真實 Atlas／GCS／Cloud Build／Scheduler／Firebase E2E                                    | **NOT RUN**，待完成第 3～4 節；不能據上述測試勾選完整 P05-08 雲端驗收                                                               |

Job 套件新增直接依賴固定為既有相容版本 `google-auth-library@11.3.3`、`zod@4.6.7`，未更換技術棧。Deployments 新欄位為選用文字、不新增索引；Docker 回歸通過，Atlas 部署時仍需確認舊紀錄可讀、新紀錄可寫。前台 UI 未變更，本輪未重跑視覺 baseline／Playwright 或 Lighthouse。

官方參照：[排程執行 Cloud Run Job](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)、[Cloud Scheduler OAuth](https://docs.cloud.google.com/scheduler/docs/http-target-auth)、[Cloud Build IAM](https://docs.cloud.google.com/build/docs/iam-roles-permissions)、[Firebase Hosting API 部署](https://firebase.google.com/docs/hosting/api-deploy)。
