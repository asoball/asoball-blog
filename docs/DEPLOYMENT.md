# Deployment — GCP / Atlas / Firebase

**實際手動操作請先閱讀 [GCP 手動部署操作手冊](GCP_MANUAL_DEPLOYMENT.md)**。使用者已確認沿用 Firebase Hosting；手冊以 Console 繁中介面為主，必要設定與 Optional 分開，gcloud／Terraform 另列 [CLI 選用附錄](GCP_GCLOUD_REFERENCE.md)。本文件保留目標架構與階段規格。目前 CMS image 只提供後台，既有 Cloud Build YAML 只建候選版本；不能將下列目標 pipeline 誤認為已完成真實雲端串接。GCS Private ACL 與 UBLA 的相容性修正、M0／GCS 複驗與前台發布均須按手冊完成。

> 本文件為執行 Runbook 與驗證清單，非已驗證的一鍵部署腳本。所有 ID、區域、CLI 旗標與權限需在實作時依官方文件核對。建議先建立 dev，再部署 prod。

## 執行時機

本文件中的雲端操作統一於 **P04-06 本機 UAT 通過後**，依 Phase 5／6 任務執行。Phase 0～4 先完成 CMS、前台、本機媒體、發布／回滾與本機 E2E，以及雲端 adapter、Terraform、Cloud Build、Firebase、IAM/WIF 設定檔的實作與本機檢查；不要求建立 Atlas、GCP、GCS 或 Firebase，也不提前執行需要雲端帳密的 Terraform plan。Phase 5 才填入真實測試環境參數並驗證服務整合。

雲端順序為 P05-01 plan／成本審核 → P05-02 授權建立測試資源 → P05-03 NAT／allowlist → P05-04 M0 複驗 → P05-05 GCS → P05-06／07 CMS／Hosting → P05-08 完整發布 → P05-09 回滾演練。網路／媒體驗證可使用受保護的測試服務，不等同正式部署。Phase 6 完成營運與最終 UAT 後另行核准 production；本次規劃未授權建立資源或更動 IAM。

## 1. 環境與命名
- GCP project: `<PROJECT_ID>`；region: `asia-east1`；GitHub repo: `<ORG>/<REPO>`。
- Cloud Run: `tech-blog-cms`；VPC 沿用專案既有 `default`；subnet 選該網路下與 Run 同 Region 的既有 subnet（名稱與 CIDR 依實際值）；Cloud Router: `tech-blog-router`；NAT: `tech-blog-nat`；static IPv4: `tech-blog-egress-ip`。Router／NAT／固定 IP 可在確認相容且無共用服務衝突後沿用既有設定。
- GCS: `<PROJECT_ID>-blog-media`、`<PROJECT_ID>-blog-snapshots`。
- Firebase Hosting site: `blog`；CMS domain: `admin.example.com`；Blog domain: `blog.example.com`。
- Atlas M0 選與 Cloud Run 相近且支援的 provider/region；若不能同區域，記錄延遲與跨區傳輸成本。

## 2. Terraform 管理資源
啟用 APIs：run、artifactregistry、cloudbuild、compute、secretmanager、storage、iam、logging、monitoring、firebasehosting（Firebase project/site 初始化可先 Console）。
手動部署沿用既有 default VPC 與同區 subnet，不另外建立網路；其餘依需求建立或沿用 Cloud Router、保留 static external IPv4、Public Cloud NAT（manual IP allocation），以及 GCS、Artifact Registry、Cloud Run service、Service Accounts、Secret Manager、必要 IAM、Budget Alerts（依 Billing 權限）。現有 Terraform 模板仍會建立獨立 VPC／subnet；若採 Terraform，必須先調整為引用既有網路，不能直接套用現有模板。
- Terraform state 使用獨立受限 GCS bucket + versioning，避免把密碼放在 state。
- Terraform `plan` 必須人工審核，`apply` 必須人工確認。

## 3. Direct VPC Egress / NAT 必要條件
- Cloud Run：`--network=<VPC> --subnet=<SUBNET> --vpc-egress=all-traffic`。
- NAT：在 Cloud Run 同 region，涵蓋所用 subnet；`--endpoint-types=ENDPOINT_TYPE_VM`，配置手動保留的 static IPv4。
- Cloud NAT 最小 ports per VM 依 Cloud Run 實際連線需求調整；遵循 Google Cloud 對 Direct VPC egress 的指引。
- Cloud NAT **不會自動提供固定入口 IP**；它是出口 NAT。
- Atlas IP Access List：只加入 NAT 的固定 Public IPv4 `/32`；不要在正式環境用 `0.0.0.0/0`。
- 先用測試服務驗證實際對外 IPv4 等於保留 IP，再測試 MongoDB TLS 連線。
- `all-traffic` 也會將其他公網出口送經 NAT，包含對外 API；檢查路由、防火牆、DNS 和成本。

## 4. Secrets 與 IAM
- Secret Manager：`DATABASE_URI`、`PAYLOAD_SECRET`、部署 webhook/token（若使用）；Cloud Run 執行身分只讀所需 secret。
- Cloud Run service account：GCS media 所需最小權限、secret accessor、發布觸發權限；禁止 Owner/Editor。
- Cloud Build service account：讀取 published snapshot / 必要資料、Hosting 部署權限、Artifact Registry 讀寫（按 pipeline 分開）。
- GitHub Actions 使用 Workload Identity Federation，避免長期 JSON 金鑰。
- MongoDB 帳號專用、最小資料庫權限；密碼輪替流程需文件化。

## 5. Atlas 建置
1. 建立 M0 Cluster，選擇區域與 provider。
2. 建立應用程式資料庫使用者（非 Atlas 組織管理員）。
3. 設定 IP Access List 為 NAT static IPv4/32。
4. 將 MongoDB URI 存入 Secret Manager；必須 TLS；不得寫入 Git。
5. 驗證 Payload 建表/索引、draft/version、媒體關聯、發文及資料庫容量。

## 6. CMS 容器

CMS 建置流程改為手動設定 Cloud Build trigger，設定檔使用 `infrastructure/cloudbuild/cms.yaml`；首次 `_DEPLOY_CMS=false` 只建映像，完成 Run 初始化後才啟用候選 revision 更新。建構前需核准，候選版本使用 `--no-traffic`，最後由人員在 Console 驗證並切換指定 revision。`infrastructure/cloudbuild/blog.yaml` 是另一條 Astro candidate 建置，不可混用。詳見手冊第 3.6 節；目前尚未執行雲端驗證。
- 使用官方 Payload Next.js template 初始化；MongoDB adapter `@payloadcms/db-mongodb`、GCS adapter `@payloadcms/storage-gcs`。
- Next.js `output: 'standalone'`；multi-stage Dockerfile；Node LTS 版本與 Payload/Next.js 相容性先驗證。
- 初始 Cloud Run：region asia-east1，1 vCPU、1Gi RAM、min=0、max=1、concurrency=10、request timeout 依實測設定；若記憶體不足調整。
- 服務可公開抵達登入頁，但所有管理功能依 Payload ACL 保護；考慮 Cloud Armor / Identity-Aware Proxy 為未來選項（會增加成本/複雜度）。
- Cloud Run revision 部署使用不可變 image digest，不使用 `latest` 作為回滾依據。

## 7. Astro 建置與 Hosting
- Astro `output: 'static'`、`site=https://blog.example.com`；使用 snapshot 產生文章路由、分類、標籤、sitemap、RSS。
- Cloud Build pipeline：checkout 固定 commit → download immutable snapshot → install frozen lockfile → lint/typecheck/build/smoke → deploy Firebase Hosting → 記錄 release ID。
- Firebase Hosting `public` 指向 Astro dist；設定 cache headers：HTML 短 TTL、帶 hash assets 長 TTL；custom domain + TLS。
- 發布後檢查首頁、文章頁、sitemap、RSS、404；失敗保留前一 Hosting 版本。

## 8. CI/CD 分離
- PR：lint、typecheck、unit、build，不存取 production secrets。
- main merge：build CMS image → Cloud Run deploy（人工 gate 或受控 release）。
- CMS Publish：受保護 trigger → snapshot → Astro build → Hosting deploy。
- 一個 release 在同一時間只能部署一次；若有較新 release，舊 release 禁止覆蓋。

## 9. 部署驗證清單
- [ ] NAT static IPv4 驗證
- [ ] Atlas 僅允許 NAT IP，連線成功
- [ ] CMS admin 登入成功，匿名 API 拒絕寫入
- [ ] GCS 圖片跨重啟仍存在
- [ ] 草稿不出現在公開站或 sitemap
- [ ] 發布/取消發布/刪除重建正確
- [ ] Cloud Run scale-to-zero 後 CMS 冷啟動正常
- [ ] Hosting rollback 演練
- [ ] Cloud Logging/Monitoring/Budget Alert 啟用
