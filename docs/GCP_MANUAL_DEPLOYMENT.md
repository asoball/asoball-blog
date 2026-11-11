# GCP 手動部署操作手冊（Console 優先）

更新：2026-11-05。本手冊以 **GCP Console、Firebase Console、Atlas 網頁介面**為主要操作方式，繁體中文名稱後酌附英文以便辨識。Google 介面可能分批更新，少數項目仍顯示英文，可用 Console 上方搜尋列尋找產品。

**必要設定依第 1～4 節順序完成；選用項目集中第 5 節；gcloud／Terraform 替代方式放在第 6 節附錄連結。** 設定是必要的，不代表必須使用 gcloud。本文沒有實際建立、修改或部署任何雲端資源，不能當作雲端驗收已完成的證據。

## 1. 上線範圍與必要／Optional 總表

已確認沿用 Firebase Hosting，不新增前台 Cloud Run：

```text
訪客 → Firebase Hosting → Astro 靜態文章、最佳化公開圖片
管理者 → Cloud Run CMS → Atlas M0
                      → private GCS media Bucket
Cloud Run → Direct VPC egress → Cloud NAT 固定 IPv4 → Atlas allowlist
人工發布：published snapshot → Astro build → 驗證 → Firebase Hosting
```

### 必要項目

| 項目                                                      | 用途                                           | 主要操作位置                      |
| --------------------------------------------------------- | ---------------------------------------------- | --------------------------------- |
| GCP Project、Billing、API                                 | 專案、計費與產品啟用                           | GCP Console                       |
| 既有 default VPC／同區 subnet、Router、NAT、reserved IPv4 | 固定出口，供 Atlas `/32` allowlist；不另建 VPC | GCP Console                       |
| Atlas Free／M0、DB user、allowlist                        | CMS 內容、管理者、版本與 outbox                | Atlas 網頁                        |
| private GCS media Bucket                                  | 原圖持久化，禁止匿名存取                       | GCP Console                       |
| CMS service account、Bucket／Secret IAM                   | 執行身分與最小權限                             | GCP Console                       |
| Secret Manager：2 個 secrets                              | DATABASE_URI、PAYLOAD_SECRET                   | GCP Console                       |
| Artifact Registry                                         | CMS image 保存                                 | GCP Console；映像建置／推送需工具 |
| Cloud Build API、CMS trigger／建置 SA                     | CMS image 建置與 Run 候選 revision             | Console，第 3.6 節                |
| Cloud Run：1 個 CMS service                               | Payload／Next.js 後台                          | GCP Console                       |
| Firebase Hosting：1 個 site                               | Astro 前台與 HTTPS                             | Firebase Console；內容發布需 CLI  |
| 首位 CMS 管理者                                           | 登入與內容管理                                 | 操作機受信任 bootstrap CLI        |
| 上線驗收、備份／還原、費用與日誌檢查                      | 正式運作與復原準備                             | 第 4 節                           |

### Optional 項目

| 項目                                    | 是否可先略過                               | 詳細位置  |
| --------------------------------------- | ------------------------------------------ | --------- |
| Bucket「物件版本管理」                  | 可；不是上傳／閱讀的必要條件               | 第 5.1 節 |
| 額外調整「虛刪除」、生命週期規則        | 可先保留預設，記錄實際保留時間與費用       | 第 5.2 節 |
| 自訂網域／DNS                           | 可，先用 run.app／web.app                  | 第 5.3 節 |
| Astro 內容自動發布、GitHub Actions、WIF | 可；CMS Cloud Build trigger 已移至必要項目 | 第 5.4 節 |
| snapshots／candidates 額外 Bucket       | 人工路線可略過，產物先留操作機             | 第 5.4 節 |
| Firebase Analytics、AI 輔助             | 可；本專案功能不依賴                       | 第 5.5 節 |
| gcloud／Terraform 設定資源              | 可，Console 已完成就不用再跑               | 第 6 節   |

不需要為本專案啟用 Firebase App Hosting、Authentication、Firestore、Realtime Database、Cloud Storage for Firebase，也不需註冊 Firebase Web App 或複製 firebaseConfig。原始媒體使用本手冊建立的 GCS Bucket。

## 2. 必要前置：先確認程式與部署資料

### 2.1 目前程式限制（部署前必讀）

| 項目          | 必要處理                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GCS 與 UBLA   | 已移除逐物件 ACL 操作，保留官方 adapter、ADC、Bucket IAM 與 Payload 媒體 ACL；本機契約回歸通過後仍須真實 GCS upload／匿名拒絕複驗。Bucket 維持 private／UBLA，不改公開                                                                     |
| Atlas DB 名稱 | 雲端模式已支援自訂 DB 名稱（如 `asoball_blog_prod`），可用 `DATABASE_NAME` 比對 URI DB 名稱。local 模式仍只接受專用 Docker DB；既有雲端 `asoball_blog_dev` 不需改名或重建，Atlas DB user 權限必須對應實際 DB                               |
| 雲端環境設定  | 使用 `DEPLOYMENT_ENV=cloud`，或由 Atlas SRV／Cloud Run K_SERVICE 偵測。要求 Atlas SRV／TLS、private GCS；網址若設定須 HTTPS。`CMS_URL` 可在首次 private revision 尚未取得網址時暫缺，公開登入前必須補齊並跑 config:check；不回退 localhost |
| CMS image     | 現有 Dockerfile 是官方 Payload／Next.js standalone，非 root、PORT=3000／HOSTNAME=0.0.0.0；不包含公開 Astro server 或 bootstrap CLI                                                                                                         |
| 發布          | CMS hook 只寫 outbox，前台仍按第 3.9 節人工發布。`cms.yaml` 是 CMS 映像／Run 候選版本；`blog.yaml` 只建 Astro candidate，前台自動鏈路仍待 P05-08                                                                                           |
| 健康檢查      | `/api/health` 只代表 liveness；仍須實測 Atlas 登入、GCS 與發布                                                                                                                                                                             |
| 備份          | 現有 `pnpm backup` 是本機 Docker DB／本機媒體工具，不能直接當 Atlas／GCS 備份                                                                                                                                                              |

上述相容性程式已調整，真實 M0／GCS 驗證仍是上線門檻；本機成功不宣稱雲端通過。使用者回報已完成 Console 第 3.1～3.5 節，本輪不更動既有雲端資源。請提交最新程式與 lockfile，讓第 3.6 節 Cloud Build 使用修正後的 commit。

### 2.2 先填寫並審查部署計畫

Console 沒有跨產品的一鍵 dry-run。先填下表，審查名稱、區域、成本、權限與 image digest，才按各產品的「建立」或「部署」。若需要可保存的機器 plan，使用第 6 節 Optional Terraform 路線。

| 參數                  | 範例／初始設定                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| Project ID            | 自己的專用 GCP project ID；以下用 `PROJECT_ID` 代表                                                         |
| 統一名稱前綴          | `asoball-blog-test`；以下用 `NAME` 代表                                                                     |
| Region                | `asia-east1`；Run、subnet、NAT 同區，Atlas 選實際可用且接近的 Free 區域                                     |
| VPC／subnet           | 既有 `default` VPC／該網路下與 Run 同 Region 的既有 subnet；記錄實際名稱及 IPv4 範圍，不預設 `10.80.0.0/24` |
| Router／NAT／IP       | `NAME-router`／`NAME-nat`／`NAME-egress`                                                                    |
| Bucket                | `PROJECT_ID-NAME-media`，需全域唯一，Standard、單一區域、private、UBLA                                      |
| CMS SA                | `NAME-cms@PROJECT_ID.iam.gserviceaccount.com`                                                               |
| Secrets               | `NAME-database-uri`、`NAME-payload-secret`，記錄實際版本號                                                  |
| Registry／CMS service | Docker repository `NAME-cms`／Run service `NAME-cms`                                                        |
| Run 容量              | 1 vCPU、1 GiB、min=0、max=1、concurrency=10、timeout=300 秒                                                 |
| Firebase              | 沿用同一 GCP Project，單一預設 Hosting site                                                                 |

M0 免費不代表整體免費；NAT／IPv4、Run、GCS 容量／操作／保留資料、Registry、Secrets、Logging、資料傳輸都可能計費。建立前核對 [Cloud Run 價格](https://cloud.google.com/run/pricing)、[Cloud NAT 價格](https://cloud.google.com/nat/pricing)。Budget 是通知，不會自動中止計費。

## 3. 必要設定：依序使用網頁介面操作

### 3.1 GCP 專案、計費、API

1. GCP Console 上方專案選擇器 →「新增專案」或選既有專用專案；記錄 **專案 ID**，不是顯示名稱。
2. 「帳單」（Billing）→ 確認此專案已連結正確帳單帳戶。
3. 「帳單」→「預算與快訊」→「建立預算」；範圍選此專案，輸入可接受月額與通知門檻，核對收件人。
4. 「API 和服務」→「程式庫」；搜尋並啟用下列必要產品 API。部分 API 在使用產品時會提示啟用，已啟用者不必重複操作：

| API                                           | 用途                                  |
| --------------------------------------------- | ------------------------------------- |
| Cloud Run Admin API                           | Cloud Run                             |
| Compute Engine API                            | VPC、Router、NAT、IP                  |
| Artifact Registry API                         | image repository                      |
| Cloud Build API                               | CMS trigger 建置／推送與候選 revision |
| Secret Manager API                            | secrets                               |
| Cloud Storage API                             | Bucket                                |
| Identity and Access Management API            | service account／IAM                  |
| Cloud Resource Manager API                    | project 管理與 Firebase 整合          |
| Firebase Management API、Firebase Hosting API | 第 3.7 節加入 Firebase 時啟用／確認   |
| Cloud Logging API、Cloud Monitoring API       | 日誌與監控                            |

操作人員需具備建立資源、調整指定資源 IAM、部署並使用 CMS SA 的權限；由管理員依組織政策授予。不要把 Owner／Editor 授予 runtime SA。

### 3.2 固定出口：VPC、subnet、IP、Router、NAT

以下是既有 Atlas `/32` allowlist 架構的必要資源，不是 Optional。

1. 「VPC 網路」→「VPC 網路」→ 點選既有 **`default`**。本流程不按「建立 VPC 網路」，也不把 default 轉換成自訂模式。若清單沒有 default，先確認專案是否選錯或網路是否已移除，不逕自建立另一個 VPC 替代。
2. 在 default 的「子網路」清單選擇與 Cloud Run **同 Region** 的既有 subnet；自動模式的名稱通常為 `default`，以畫面實際值為準。記錄名稱、Region、主要 IPv4 範圍與可用位址；Direct VPC egress 要求範圍 `/26` 或更大，還須有足夠未使用 IP。檢查「私人 Google 存取權」（Private Google Access）設定，依部署需求啟用。本流程不新增 `NAME-egress` subnet、不指定新 CIDR；若缺少可用的同區 subnet，先停止並確認網路配置。
3. 搜尋「IP 位址」→「外部 IP 位址」→「保留外部靜態 IP 位址」。名稱 `NAME-egress`、IPv4、區域性、相同 Region；保留後記錄位址。若經 NAT 建立頁的「保留新位址」完成，勿重複保留第二個。
4. 先檢查 default VPC／該 Region 是否已有 Cloud Router 或 NAT 涵蓋所選 subnet。若已有，先確認能否使用其固定出口 IP；不要新增重疊的 NAT，也不要逕自改動其他服務共用的 NAT／防火牆。若尚無對應設定，搜尋「Cloud NAT」→「開始使用」或「建立 Cloud NAT 閘道」，選 **Public NAT**、網路 **`default`**、相同 Region；建立 Cloud Router `NAME-router`，或選擇同網路／同 Region 的合適既有 Router。
5. 新建 NAT 名稱 `NAME-nat`；來源範圍選自訂，只涵蓋第 2 步實際選定 subnet 的主要 IPv4 範圍。NAT IP 分配選「手動」，選剛保留的固定 IPv4；不要選自動分配，也不要為本專案直接涵蓋 default 的所有區域 subnet。若沿用既有 NAT，記錄其實際靜態出口 IP，供 Atlas allowlist 使用。
6. 若介面提供端點類型，選涵蓋 VM／Direct VPC egress 的 `ENDPOINT_TYPE_VM`。進階選項最小通訊埠數初始設 64；日誌選僅錯誤。確認摘要後建立。
7. 第 3.8 節 Cloud Run 必須選 **Direct VPC egress＋將所有流量轉送至 VPC**。只選私人 IP 流量，Atlas 公網連線不會經固定 NAT。

NAT IP 是出口，不是 CMS 入口。若第 4 步確認沿用既有 NAT／固定 IP，第 3 步可略過保留新 IP，避免建立未使用的位址。建立或沿用後仍須以同 VPC 測試 workload 驗證實際出口，不能以操作機出口 IP 代替。參照 [官方固定出口流程（繁中）](https://docs.cloud.google.com/run/docs/configuring/static-outbound-ip?hl=zh-tw)、[Direct VPC subnet 條件](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc?hl=zh-tw)。

### 3.3 Atlas Free／M0

1. 在 [Atlas Console](https://cloud.mongodb.com/) 建立專用 Project → 建立 Free／M0 cluster。確認沒有誤選 Flex／付費 Dedicated；記錄 provider／region。
2. 「Database Access」建立應用 DB user；授權指定 `asoball_blog_dev` 的 readWrite，限制指定 cluster。這不是 Atlas 網站登入帳號，也不是 CMS 管理者。
3. 「Network Access」新增第 3.2 節 NAT IPv4 `/32`，不要使用 `0.0.0.0/0`。
4. Cluster「Connect」→「Drivers」取得 SRV URI，明確設定 DB 名稱、TLS 與 authSource；密碼／使用者需 URL encode：

```text
mongodb+srv://<encoded-user>:<encoded-password>@<cluster-host>/asoball_blog_dev?retryWrites=true&w=majority&authSource=admin&tls=true
```

不要沿用本機 `directConnection=true`／`replicaSet=rs0`，不要把 URI 放 Git 或 build args。M0 的交易、索引、版本、ACL、連線與容量限制必須另做真實驗證，見 [Free 限制](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)。

### 3.4 建立 CMS 執行身分與 private Bucket

1. 「IAM 與管理」→「服務帳戶」→「建立服務帳戶」，ID `NAME-cms`；先不授予 project-wide 角色、不建立金鑰。
2. 「Cloud Storage」→「值區」（Buckets）→「建立」。填全域唯一媒體 Bucket 名稱；位置類型選「區域」，Region 同 Run；儲存空間級別選 Standard。
3. 存取控管選 **「統一」**（Uniform bucket-level access），啟用 **「禁止公開存取」**（Public access prevention）；不授予 allUsers。
4. 保護設定：**此時不必啟用「物件版本管理」**，也不必設定／鎖定保留政策；虛刪除可先保留介面預設，但需記錄天數與費用。Optional 詳見第 5 節。
5. 建立後開啟 Bucket →「權限」→「授予存取權」，新增剛建立的 CMS SA，角色選「Storage 物件使用者」（`roles/storage.objectUser`）。權限只設在此 Bucket。

使用包含第 2.1 節 GCS ACL 修正的最新 commit；不要為了解決上傳失敗而取消 private／UBLA。參照 [建立 Bucket（繁中）](https://docs.cloud.google.com/storage/docs/creating-buckets?hl=zh-tw)、[UBLA](https://docs.cloud.google.com/storage/docs/uniform-bucket-level-access)。

### 3.5 Secret Manager

1. 搜尋「Secret Manager」→「建立密鑰」（Create secret）。名稱 `NAME-database-uri`，值填完整 Atlas URI，記錄版本號。
2. 再建立 `NAME-payload-secret`；值為密碼管理工具產生的至少 32 字元高熵隨機值，不使用本機 secret 或 Docker build placeholder。
3. 複寫政策可選「自動」；若組織有資料落地規定，依政策選位置。
4. 分別在兩個 secret 的「權限」→「授予存取權」，新增 CMS SA，角色「Secret Manager 密鑰存取者」（`roles/secretmanager.secretAccessor`）。不要直接授予整個專案所有 secret 權限。

後續 Run revision 使用同一正式 PAYLOAD_SECRET，綁定明確版本號；不要把值貼在 Run 一般環境變數或部署紀錄。見 [Cloud Run 密鑰設定（繁中）](https://docs.cloud.google.com/run/docs/configuring/services/secrets?hl=zh-tw)。

### 3.6 透過 Cloud Build 觸發條件建置 CMS

Console：「Artifact Registry」→「存放區」→「建立存放區」：名稱 `NAME-cms`、格式 Docker、模式「標準」、位置類型「區域」、Region 同 Run。建立後記錄 repository 路徑。

本節改用 **Cloud Build Console 連接 Git repo、設定 trigger**，不必在操作機執行 Docker build／push。首次先產生 image，依第 3.8 節建立 Cloud Run 並設定網路／Secrets；後續 trigger 可建立 Run 候選修訂版本，由人員在 Console 確認流量切換。

#### A. 建立 CMS 專用建置身分

「IAM 與管理」→「服務帳戶」→ 建立 `NAME-cms-build`，與 `NAME-cms` runtime SA 分開，授予：

| 權限                                                        | 授予範圍／時機                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Artifact Registry 寫入者（`roles/artifactregistry.writer`） | 只在 CMS repository 授予                                                         |
| 記錄檔寫入者（`roles/logging.logWriter`）                   | project，搭配 CLOUD_LOGGING_ONLY                                                 |
| Cloud Run 開發人員（`roles/run.developer`）                 | 首次 image-only 不需要；Run 建立後只在該 CMS service 授予，供讀取／更新 revision |
| 服務帳戶使用者（`roles/iam.serviceAccountUser`）            | 啟用 Run 更新前，只在 CMS runtime SA 授予，允許部署使用該執行身分                |

建置 SA 不讀 Atlas URI／PAYLOAD_SECRET、不管理 Bucket、不授予 Owner／Editor 或 Run IAM 管理權。操作者需能建立 trigger、使用建置 SA；核准人需 Cloud Build 核准者（`roles/cloudbuild.builds.approver`）。來源連線依精靈授權指定 Git repo。

#### B. 連接原始碼與建立 trigger

1. 「API 和服務」→「程式庫」啟用 **Cloud Build API**。
2. 「Cloud Build」→「存放區」（Repositories）／「連線」→ 依精靈連接 GitHub repo。先提交並推送專案、lockfile、Dockerfile 與 **`infrastructure/cloudbuild/cms.yaml`**。
3. 「Cloud Build」→「觸發條件」（Triggers）→「建立觸發條件」；名稱 `NAME-cms`，Region 與 repository connection 相符，建議同部署區域。
4. 「事件」選 **推送至分支**，分支規則 `^main$`；以受保護分支審查變更，不讓外部 PR／任意分支執行部署。
5. 「設定」選 **Cloud Build 設定檔（YAML 或 JSON）**，位置選存放區，路徑填 **`infrastructure/cloudbuild/cms.yaml`**。不要用 `blog.yaml` 或 buildpacks；此 monorepo 的 Dockerfile 在 `apps/cms/`，但 build context 必須是 repo 根目錄，YAML 已設定好。
6. 「服務帳戶」選 `NAME-cms-build`；「核准」勾選 **建構作業執行前須經核准**。核准前查看 commit、來源與替代變數。
7. 設定以下替代變數，不放入任何 secret：

| 變數          | 值                                                              |
| ------------- | --------------------------------------------------------------- |
| `_REGION`     | Run／Registry 實際 Region，例如 `asia-east1`                    |
| `_REPOSITORY` | 既有 CMS repository 名稱，例如 `asoball-blog-test-cms`          |
| `_SERVICE`    | 第 3.8 節 CMS Cloud Run service 名稱                            |
| `_DEPLOY_CMS` | **首次 `false`**，只建置／推送；Run 建好及權限完成後設為 `true` |

8. 初期不設定檔案篩選，避免共用套件變更漏建；日後限制時須包含 `apps/cms/**`、`packages/**`、root lockfile／workspace／設定、`.dockerignore` 與此 YAML。
9. 儲存 trigger，按「執行」選 main commit；到 build 明細核對後「核准」。Cloud Build 會以固定 commit tag 建置並推送 image，日誌輸出 immutable digest。

#### C. 首次與後續部署

- **首次**：`_DEPLOY_CMS=false`。Registry → CMS image → 此 commit 版本，複製 `.../cms@sha256:...`，接續第 3.8 節建立 Cloud Run。建好 image 不代表 Run 服務已建立。
- **後續**：授予建置 SA Run／actAs 權限，改 `_DEPLOY_CMS=true`。核准 build 後，以 digest 更新**既有** CMS service，使用 `--no-traffic` 建立候選 revision，保留現行流量與既有 VPC／Secrets 設定；不新建服務、不修改公開存取 IAM。
- Cloud Run →「修訂版本」核對候選版本的 digest／commit、Secrets、CMS_URL、default VPC／同區 subnet、all-traffic 與容量。可使用受保護的修訂版本測試入口驗證，再由「管理流量」明確指定通過驗收的 revision 切換；不要只根據「最新版本」切流量。
- 失敗不切換線上流量。多次 build 重疊時，人工核對特定 commit／revision，避免較舊程式被切成線上版本；保留前一成功 revision 供回滾。

此流程會產生 Cloud Build 建構、日誌及 Registry 儲存費用。建置不需要 Atlas allowlist 或正式 DB secrets；部署前仍須完成第 2.1 節必要修正。本次只新增設定檔及文件，未建立 trigger、執行雲端 build 或部署。

參照 [Cloud Build trigger（繁中）](https://docs.cloud.google.com/build/docs/automating-builds/create-manage-triggers?hl=zh-tw)、[建構核准](https://docs.cloud.google.com/build/docs/securing-builds/gate-builds-on-approval?hl=zh-tw)、[自訂建置 SA](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts?hl=zh-tw)。

### 3.7 Firebase Console

1. 登入 [Firebase Console](https://console.firebase.google.com/)，建立專案入口選「將 Firebase 新增至 Google Cloud 專案」（Add Firebase to Google Cloud project），選**同一個既有 GCP project**，接受條款。
2. 「專案設定」核對「專案 ID」一致；已有 Billing 的專案會使用 Blaze 計費方案，不是另外建立一個 GCP 專案。
3. 開啟 **Hosting**，依「開始使用」提示準備預設 site；記錄 Site ID 與 `https://SITE_ID.web.app`。不要選 App Hosting，也不必建立第二個 site。
4. CLI 初始化提示只作參考：repo 已有 `firebase.json`，不要重跑 init 覆寫。public 路徑、cache headers 已在該檔，不用 Console 重設。
5. AI 輔助、Google Analytics、自訂網域都是 Optional；不需啟用其他 Firebase 資料庫／登入／Storage 產品。

參照 [既有 GCP project 加入 Firebase](https://firebase.google.com/docs/projects/use-firebase-with-existing-cloud-project)、[Hosting 開始使用](https://firebase.google.com/docs/hosting/quickstart)。

### 3.8 Cloud Run Console

「Cloud Run」→「服務」→「部署容器」／「建立服務」，選「從現有容器映像檔部署」。先審查以下設定摘要，再按「建立」：

本節為首次初始化。後續透過第 3.6 節 Cloud Build trigger 建候選 revision，再於 Console 驗證並切換流量。不重建另一個 service，也不另外啟用 Cloud Run 來源自動部署精靈，以免重複觸發。

| 畫面設定            | 填寫內容                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 容器映像檔網址      | 第 3.6 節完整 immutable image digest                                                                                         |
| 服務名稱／區域      | `NAME-cms`／與 subnet 相同 Region                                                                                            |
| 驗證                | 初始「要求驗證」；完成設定與管理者初始化後再開公開登入頁                                                                     |
| 輸入流量（Ingress） | 允許所有來源到達；仍由驗證／Payload ACL 控制權限                                                                             |
| 服務帳戶            | 「安全性」選第 3.4 節 CMS SA，不用預設廣權限帳號                                                                             |
| 容器連接埠          | `3000`；image 已設定 HOSTNAME=0.0.0.0                                                                                        |
| CPU／記憶體         | 1 vCPU／1 GiB，記憶體不足再依實測調整                                                                                        |
| 資源調度            | 最小執行個體 0、最大 1；每個執行個體並行要求 10                                                                              |
| 要求逾時            | 300 秒                                                                                                                       |
| 網路                | 選連線至 VPC、Direct VPC egress；VPC 選既有 `default`，subnet 選第 3.2 節記錄的同 Region 既有 subnet                         |
| 輸出流量（Egress）  | **將所有流量轉送至 VPC**（all-traffic）                                                                                      |
| 環境變數            | `DEPLOYMENT_ENV=cloud`、`MEDIA_STORAGE=gcs`、`GCS_BUCKET=實際媒體 Bucket 名稱`；可選 `DATABASE_NAME` 比對 URI 中既有 DB 名稱 |
| 參照密鑰的環境變數  | `DATABASE_URI` → database-uri secret；`PAYLOAD_SECRET` → payload-secret；均選明確版本號                                      |

建立後取得 Cloud Run 預設 HTTPS URL。進入服務 →「編輯及部署新修訂版本」，新增一般環境變數 `CMS_URL=實際完整 https://...run.app URL`，再部署。首次不知道 URL 時可以先建立 private revision 再補，不能讓正式入口一直使用 localhost。

Secret 需選「變數與密鑰」中的密鑰參照，不是複製值到普通環境變數；具體分頁可能顯示在「容器、磁碟區、網路、安全性」下。

完成第 3.9 節管理者初始化並確認組織政策後，於服務「安全性」→「驗證」設定允許公開存取／未經驗證叫用。公開的是登入入口；Users、草稿、版本、寫入與原圖仍由 Payload ACL 保護。若組織禁止公開存取，須先設計相容的 IAP／身分閘道，不可假設一般瀏覽器 cookie 能通過 Cloud Run IAM。

Cloud Run 本機檔案系統是暫存；不要掛本機 `.local` 指標或把原圖留在容器磁碟。此 image 必須用 GCS。私有階段若需測 health，可用已有驗證權限的測試工具；選用 proxy 命令見第 6 節。

### 3.9 必要操作：初始化帳號、建置與發布前台

**以下不是 Console 資源設定，但目前程式仍需這些操作機工具步驟。** Firebase Console 本身不能取代 Astro 建置／CLI 發布，CMS 也禁止公開註冊。人員手動執行命令不等於啟用自動部署。

#### A. 準備雲端專用環境並建立管理者

1. Atlas「Network Access」暫時允許操作機實際公網 IPv4 `/32`，設定到期時間；完成後移除，保留 Run NAT `/32`。
2. 用本機編輯器將 [雲端範例](../apps/cms/.env.cloud.example) 複製到被忽略的 `.local/cloud.env`（若尚無 `.local`，先執行 `pnpm setup:local`），從 Secret Manager Console 取得正確 secret 值。使用乾淨的專用終端，不要混用先前設定的本機 DATABASE_URI 等環境變數；不貼值到聊天／Git：

```dotenv
DEPLOYMENT_ENV=cloud
DATABASE_URI=<完整 Atlas URI>
PAYLOAD_SECRET=<正式 Payload secret>
MEDIA_STORAGE=gcs
GCS_BUCKET=<實際媒體 Bucket>
CMS_URL=https://<實際 CMS Run URL>
SITE_URL=https://<實際 Hosting Site ID>.web.app
BOOTSTRAP_CREDENTIAL_FILE=.local/cloud-admin.json
BOOTSTRAP_EMAIL=<正式管理者 Email>
```

```powershell
pnpm install --frozen-lockfile
pnpm setup:local
pnpm exec node --env-file=.local/cloud.env --import tsx scripts/check-config.ts
pnpm exec node --env-file=.local/cloud.env --import tsx scripts/bootstrap.ts
```

`--env-file` 設定不會由 bootstrap 補入本機 `.env`，但既有終端的環境變數仍優先，故須使用專用乾淨終端。`check-config` 不連 Atlas／GCS、不輸出 URI／secret，僅驗證設定；不能代替真實連線測試。也可設定 `CMS_ENV_FILE=.local/cloud.env` 後執行 `pnpm config:check`／`pnpm bootstrap`。雲端 bootstrap 必須指定 BOOTSTRAP_EMAIL，憑證預設 `.local/cloud-admin.json`；已有管理者時不重設，憑證檔也不覆寫。若初始化失敗而留下新憑證檔，先確認 DB 帳號是否建立，再人工處理，勿盲目重跑／覆蓋。不要對 Atlas 執行 `seed:local`。

#### B. 匯出 published 快照並建置

操作機需要可讀 media Bucket 的 Google ADC（應用程式預設憑證），不是只有網站登入。已有組織提供的 ADC 可沿用；若尚未配置，選用第 6 節的互動登入方式。**工具選用，但有效身分驗證不能省略**，不以下載長期 SA JSON key 當預設方案。

同一時間只允許一位操作者發布，停止其他 publisher／CI deploy，建置期間暫停內容編輯：

```powershell
$manualRelease = 'manual-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
pnpm exec node --env-file=.local/cloud.env --import tsx scripts/export-snapshot.ts $manualRelease
$snapshotDirectory = Join-Path (Get-Location) ".local/snapshots/$manualRelease"
$env:CONTENT_SNAPSHOT = Join-Path $snapshotDirectory 'snapshot.json'
$env:BLOG_OUT_DIR = Join-Path (Get-Location) '.local/cloud-candidate/site'
$env:SITE_URL = 'https://REPLACE_HOSTING_SITE.web.app'
if (Test-Path -LiteralPath $env:BLOG_OUT_DIR) { throw 'Use a clean deployment workspace; candidate already exists.' }
pnpm --filter blog build
Copy-Item -LiteralPath (Join-Path $snapshotDirectory 'media') -Destination $env:BLOG_OUT_DIR -Recurse
pnpm exec tsx scripts/seo-check.ts $env:BLOG_OUT_DIR
```

每次使用乾淨部署工作目錄，先封存上一版產物，不合併舊 candidate，避免取消發布後留下舊文章檔案。不要直接部署未設定 CONTENT_SNAPSHOT／SITE_URL 的 fixture build。

#### C. Firebase 預覽與人工發布

```powershell
npm install --global firebase-tools@15.35.0
firebase login
$deployProject = 'REPLACE_PROJECT_ID'
# 本機預覽，不更新線上版本；驗收後 Ctrl+C 結束
firebase emulators:start --only hosting --project $deployProject
# 確認 project／site／內容與回滾版本後，才執行正式發布
firebase deploy --only hosting --project $deployProject
```

先用本機預覽作為人工審查，不把它稱為遠端部署的通用 dry-run。現有 `firebase.json` public 指向 `.local/cloud-candidate/site`；多 site 時須先設定明確 target，不直接部署到不確定的預設 site。

發布／更新／取消發布／刪除後都要重新匯出、乾淨建置、驗證與 deploy；草稿儲存不部署。此人工流程不會把 Mongo outbox 自動改為 succeeded，不與自動 worker 混用，不冒充 P05-08 完整雲端自動發布已通過。最後移除 Atlas 操作機 `/32`，關閉雲端操作終端。

## 4. 必要上線驗收與維運

- [ ] 記錄真實 Atlas cluster／region／版本，交易、索引、slug、draft／restore、ACL 複驗通過。
- [ ] 確認 NAT 固定 IP 與 Atlas `/32`，Run 使用 all-traffic；操作機臨時 allowlist 已移除。
- [ ] Run 使用正確 image digest、CMS SA、Secrets 版本、CMS_URL、min 0／max 1；連線池上限 5。
- [ ] 瀏覽器登入、草稿預覽、GCS 上傳／讀取／刪除、新 revision 後媒體保留皆通過。
- [ ] 匿名不能寫入、取得 Users／versions／draft 或原圖；公開前台只含 published 快照與引用圖片。
- [ ] 前台首頁、文章、分類／標籤、圖片、RSS／sitemap、canonical、robots、404 正常。
- [ ] 取消發布後文章 URL、列表與 feeds 移除；CMS／Atlas 不可用時已發布前台仍可讀。
- [ ] Cloud Run 服務「記錄」／「指標」確認無啟動錯誤；Cloud Monitoring 設定可收到的可用性／錯誤告警，Billing 預算收件人正確。
- [ ] 制定 Atlas 加密匯出與 GCS 媒體備份的保留／權限策略，在隔離環境完成還原。M0 不可假設有自動備份；本機 `pnpm backup` 不適用此雲端路線。
- [ ] 部署紀錄含 project、region、NAT IP、Run revision／digest、Git commit、secret 版本（不含值）、Hosting site／release、snapshot SHA256、操作者、驗收結果與回滾目標。

Run 回滾：Console → 服務 →「修訂版本」（Revisions），選已驗證 revision 調整流量；DB schema 不會一起回滾。Hosting 回滾：Firebase Console → Hosting → 發布歷程，選已驗證舊版回復；本機 `pnpm rollback` 不會回滾雲端。

停止測試時仍須檢查 NAT／保留 IP／Bucket 版本／虛刪除等持續成本；本文不提供資料刪除或一鍵 destroy。

## 5. Optional：依需求另外設定

### 5.1 物件版本管理（對應 --versioning）

**不是 CMS／前台必要設定，初次測試可先不啟用。** 不是 Payload 文章版本，也不是 Firebase rollback。

Console：**Cloud Storage →「值區」→ 媒體 Bucket →「保護」→「物件版本管理」→ 點目前狀態 → 啟用 →「確認」**。若出現「按照建議新增生命週期規則來管理版本費用」，先檢查保留與刪除條件，不盲目勾選。

遭覆寫／刪除的物件會留下非現行版本，仍占空間並計費，預設無版本數上限；無法一併復原 MongoDB 媒體記錄或已刪除 Bucket。現有 Terraform 預設啟用 versioning，將來納管要同步選擇，避免覆蓋 Console 決策。見 [繁中操作說明](https://docs.cloud.google.com/storage/docs/using-object-versioning?hl=zh-tw)。

### 5.2 虛刪除與生命週期

同一 Bucket「保護」中的 **「虛刪除」（Soft delete）** 與物件版本管理不同。Google 對誤刪保護優先建議虛刪除；初次可保留建立畫面預設，記錄實際保留時間，並評估保留資料費用，不必為了上線額外開啟所有保護。

生命週期可用於清理非現行版本，但包含刪除行為，先人工審查條件再設定。不要為此次部署設定／鎖定保留政策。見 [版本與虛刪除差異](https://cloud.google.com/storage/docs/object-versioning?hl=zh-tw)。

### 5.3 自訂網域

前台先用 Hosting 預設 web.app；要用自己的網域，再到 Firebase Hosting「新增自訂網域」，依提示設定 DNS 並等待憑證。CMS 先用 Run 預設 URL，自訂入口另依可用區域／網域方案規劃，變更後更新 CMS_URL。初次不需額外 Load Balancer／CDN。

### 5.4 自動化與額外儲存

CMS Cloud Build trigger 已是第 3.6 節必要建置方式。本節 Optional 是 Astro「內容」自動發布，以及 GitHub Actions、WIF、snapshots／candidates 額外 Bucket。`cms.yaml` 不會發布文章或部署 Firebase；`blog.yaml` 目前也只建前台 candidate。要自動內容發布時依 P05-08 完成 orchestration、去重／序列化／fencing、版本上傳、啟用與不確定結果對帳。

### 5.5 Firebase 額外功能

Google Analytics、AI 輔助與額外 Hosting sites 可先略過。CMS 登入由 Payload 管理，不啟用 Firebase Authentication；文章在 Atlas，不啟用 Firestore／Realtime Database。

## 6. Optional：gcloud／Terraform 替代操作

若已在 Console 完成必要設定，不需再跑指令建立同名資源。指令方式統一移至 [GCP CLI 選用附錄](GCP_GCLOUD_REFERENCE.md)，包含 registry credential helper、操作機 ADC、private Run proxy、資源設定範例與 Terraform plan。

**選用的是操作工具，不是身分驗證／權限／必要資源本身。** CMS image 由第 3.6 節 Cloud Build trigger 建置；操作機仍需 bootstrap、Astro build 與 Firebase CLI deploy。若連這些也只按 Console，需另行實作初始化／前台發布工作，現階段沒有完整一鍵流程。

手動建立與 Terraform 管理二選一。**目前 `infrastructure/terraform/main.tf` 仍建立獨立 VPC／subnet，不符合本手冊已確認的 default VPC 路線**；本次只更新文件，未更動 Terraform。若未來使用 Terraform，先改為引用既有 default VPC／所選 subnet，再規劃其他既有資源的 import，不直接 apply。本文與附錄皆不執行 apply，也不將文件完成視為 P05-01～P06 驗收通過。

## 7. 排查與相關文件

| 現象                        | 優先檢查                                                                  |
| --------------------------- | ------------------------------------------------------------------------- |
| Run 無法啟動                | Secret IAM／版本、DB 名稱限制、PORT／HOSTNAME、image architecture、記憶體 |
| Atlas timeout               | NAT `/32`、all-traffic、Region、DNS／TLS、cluster 是否暫停                |
| GCS 403／400                | Bucket IAM／ADC；Private ACL 與 UBLA 衝突是否已修正                       |
| health 200 但無法登入       | health 不測 DB；檢查 bootstrap、CMS_URL／cookie／Origin、Run IAM          |
| CMS published 但前台未變    | 本路線需人工執行第 3.9 節                                                 |
| 前台出現 fixture／localhost | 正式 build 缺少 CONTENT_SNAPSHOT／SITE_URL                                |
| 重啟後圖片消失              | 誤用容器暫存檔案系統，必須使用 GCS                                        |

參照 [目標部署架構](DEPLOYMENT.md)、[任務清單](TASKS.md)、[安全與營運](SECURITY_OPERATIONS.md)、[Firebase 部署與預覽](https://firebase.google.com/docs/hosting/test-preview-deploy)。
