# GCP CLI 選用附錄

本附錄是 [Console 優先部署手冊](GCP_MANUAL_DEPLOYMENT.md) 的 **Optional 替代方式**。Console 已完成的資源不要重複建立；以下不是一鍵腳本，本次也沒有實際執行雲端命令。

先完成主手冊第 2.2 節的計畫、權限與費用審查。選用的是工具，不是必要資源或身分驗證本身。

## A. 操作機身分驗證（PowerShell）

主流程 CMS image 已改由 Console 設定 Cloud Build trigger；以下 registry credential helper 僅供另行選擇本機 Docker 建置時使用，不是第 3.6 節的前置條件。ADC 登入仍可供操作機匯出 GCS 媒體使用。

已有 Registry credential helper／組織 ADC 者可略過。CLI 登入和 Google client libraries 使用的 ADC 不同；不以長期 SA JSON key 為預設方案。

```powershell
gcloud auth login
gcloud auth configure-docker asia-east1-docker.pkg.dev
gcloud auth application-default login
```

## B. Console 資源設定的指令替代（Bash）

值均需替換；只執行尚未在 Console 完成的操作。建立與 IAM 命令會變更雲端資源，不是 dry-run。

```bash
export PROJECT_ID='REPLACE_PROJECT_ID'
export REGION='asia-east1'
export NAME='asoball-blog-test'
export NETWORK='default'
export SUBNET='REPLACE_WITH_EXISTING_SUBNET_IN_SELECTED_REGION'
export ROUTER="${NAME}-router"
export ADDRESS="${NAME}-egress"
export SERVICE="${NAME}-cms"
export MEDIA_BUCKET="${PROJECT_ID}-${NAME}-media"
export CMS_SA="${NAME}-cms@${PROJECT_ID}.iam.gserviceaccount.com"
export DB_SECRET="${NAME}-database-uri"
export PAYLOAD_SECRET_NAME="${NAME}-payload-secret"
gcloud auth list
gcloud config set project "$PROJECT_ID"
gcloud projects describe "$PROJECT_ID"

gcloud services enable run.googleapis.com compute.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com storage.googleapis.com \
  iam.googleapis.com cloudresourcemanager.googleapis.com firebase.googleapis.com \
  firebasehosting.googleapis.com logging.googleapis.com monitoring.googleapis.com
# Read-only checks: reuse the existing default VPC and regional subnet
gcloud compute networks describe "$NETWORK"
gcloud compute networks subnets describe "$SUBNET" --region="$REGION"
gcloud compute addresses create "$ADDRESS" --region="$REGION"
gcloud compute routers create "$ROUTER" --network="$NETWORK" --region="$REGION"
gcloud compute routers nats create "${NAME}-nat" --router="$ROUTER" --region="$REGION" \
  --nat-custom-subnet-ip-ranges="$SUBNET" --nat-external-ip-pool="$ADDRESS" \
  --endpoint-types=ENDPOINT_TYPE_VM --min-ports-per-vm=64 \
  --enable-logging --log-filter=ERRORS_ONLY
gcloud compute addresses describe "$ADDRESS" --region="$REGION" --format='value(address)'

gcloud iam service-accounts create "${NAME}-cms" --display-name='Blog CMS runtime'
gcloud storage buckets create "gs://${MEDIA_BUCKET}" --location="$REGION" \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets add-iam-policy-binding "gs://${MEDIA_BUCKET}" \
  --member="serviceAccount:${CMS_SA}" --role=roles/storage.objectUser
gcloud secrets create "$DB_SECRET" --replication-policy=automatic
gcloud secrets create "$PAYLOAD_SECRET_NAME" --replication-policy=automatic
```

網路檢查失敗時先確認既有 default／同區 subnet，不執行建立 VPC／subnet 的替代命令。執行 Router／NAT／IP 建立前，依主手冊確認是否已有涵蓋該 subnet 的 NAT；若沿用既有設定，略過相應建立命令，並調整變數為實際資源名稱。不要建立重疊 NAT 或修改共用服務的出口設定。

Secret 值依主手冊從 Console 加入版本，不放進命令列歷史。再綁定指定 secrets 的存取權：

```bash
for SECRET in "$DB_SECRET" "$PAYLOAD_SECRET_NAME"; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:${CMS_SA}" --role=roles/secretmanager.secretAccessor
done
gcloud artifacts repositories create "${NAME}-cms" \
  --repository-format=docker --location="$REGION"
```

## C. Cloud Run 部署的指令替代（Bash）

先完成 image 推送／digest、Atlas allowlist、GCS 相容性修正及 secret IAM。版本 1 為範例，使用實際明確版本。

```bash
export IMAGE_DIGEST='REPLACE_FULL_IMAGE_PATH_WITH_@sha256_DIGEST'
gcloud run deploy "$SERVICE" --image="$IMAGE_DIGEST" --region="$REGION" \
  --service-account="$CMS_SA" --port=3000 --cpu=1 --memory=1Gi \
  --min-instances=0 --max-instances=1 --concurrency=10 --timeout=300 \
  --network="$NETWORK" --subnet="$SUBNET" --vpc-egress=all-traffic \
  --set-env-vars="MEDIA_STORAGE=gcs,GCS_BUCKET=${MEDIA_BUCKET}" \
  --set-secrets="DATABASE_URI=${DB_SECRET}:1,PAYLOAD_SECRET=${PAYLOAD_SECRET_NAME}:1" \
  --no-allow-unauthenticated
export CMS_URL="$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')"
gcloud run services update "$SERVICE" --region="$REGION" --update-env-vars="CMS_URL=${CMS_URL}"
```

Private 階段若要從操作機測試 health，可選用下列 proxy；只測 health，不將 proxy 的 localhost 入口當成正式 CMS_URL：

```bash
gcloud run services proxy "$SERVICE" --region="$REGION" --port=8080
```

Bootstrap 與組織政策確認後，若採公開登入入口：

```bash
gcloud run services add-iam-policy-binding "$SERVICE" --region="$REGION" \
  --member=allUsers --role=roles/run.invoker
```

## D. Optional 物件版本管理（Bash）

本步不屬於必要設定。先審查非現行版本保留與費用；與虛刪除不同：

```bash
gcloud storage buckets update "gs://${MEDIA_BUCKET}" --versioning
```

## E. Optional Terraform plan（Bash）

固定 Terraform 1.13.5／Google provider 7.14.0。gcloud 沒有統一的資源部署 dry-run；若需要正式機器 plan，可使用：

```bash
terraform -chdir=infrastructure/terraform init -backend=false
terraform -chdir=infrastructure/terraform fmt -check
terraform -chdir=infrastructure/terraform validate
# 填妥真實參數、image digest 與 CMS URL 後，由人員執行：
terraform -chdir=infrastructure/terraform plan -var-file=terraform.tfvars -out=review.tfplan
```

完整 plan 需要雲端身分，佔位值不等於有效計畫。**現有 Terraform 仍建立獨立 VPC／subnet，使用前須先改為引用既有 default VPC／同區 subnet**；也包含 WIF／build SA／額外 Bucket，且預設啟用 versioning，不等於主手冊的人工最小集合。本次未修改 Terraform。其他 Console 既有資源須先規劃 import，不直接 apply；state／plan／實際 tfvars 不提交 Git。本附錄不提供 apply 或資料刪除命令。
