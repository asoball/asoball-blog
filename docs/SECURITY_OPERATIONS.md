# Security, Cost & Operations

## 1. 威脅模型與控制
| 風險 | 控制 |
|---|---|
| 匿名存取草稿 | Payload ACL + DTO 白名單 + 匯出腳本只選 published + 自動測試 |
| Atlas 帳密外洩 | Secret Manager、最小權限、定期輪替、禁止 log URI |
| 非預期 Atlas 來源 | NAT static IPv4 `/32` allowlist、TLS、DB 專用帳號 |
| CMS 被暴力登入 | Payload 登入限制、強密碼、2FA 若可行、日誌告警 |
| 惡意 Markdown / Rich Text | 禁止任意 HTML、sanitize、CSP、受測 renderer |
| 媒體公開外洩 | 公開/私人媒體策略、嚴格 upload ACL、禁止匿名寫入 |
| CI 權限過大 | WIF、專用 service account、不可變 artifact、人工 production gate |
| 錯誤發布 | 序列化、snapshot、Hosting rollback、部署狀態記錄 |

## 2. 月費模型（USD，估算不是報價）
假設 720 小時/月、1 個保留 NAT IPv4、低 CMS 流量。
- NAT IP：`720 × $0.005 = $3.60`。
- NAT Gateway：依實際計費資源使用量，參考 `$0.0014/小時/計費單位`（小規模示意 1 單位約 $1.01/月）。**Cloud Run 實際用量不可直接當成固定 1 台 VM。**
- NAT data processing：`$0.045/GiB`，例如 1 GiB 約 $0.045。
- 對外資料傳輸另計；Cloud Run、GCS、Cloud Build、Firebase Hosting、Artifact Registry、Secret Manager、Logging 依用量另計。
- Atlas M0 基本方案可免費，但配額與可用性需以官方當前價格為準。
- 先前 US$5–10/月 NAT 預算僅作小流量估算；不是費用上限。
- 設定 GCP Billing Budget Alert（例如 $5、$10、$20），**告警不會自動停止計費**。

## 3. 成本最佳化
- Astro 靜態化，避免公開流量呼叫 CMS。
- Cloud Run min-instances=0、max-instances=1，調低不必要的 log verbosity。
- 避免 Serverless VPC Access connector（優先 Direct VPC egress）；避免額外常駐 VM。
- Artifact Registry retention/cleanup policy；媒體壓縮 WebP/AVIF；避免每次草稿儲存觸發 build。
- 注意 NAT static IP、Hosting egress、Cloud Build、Cloud Logging 的常態/隱藏費用。

## 4. 監控
- Cloud Run：request errors、5xx、latency、memory、instance count、cold start。
- NAT：allocated ports、dropped packets、bytes processed。
- MongoDB：connections、storage、operations、alerts（依 M0 可用功能）。
- Cloud Build：success/failure、duration、release ID。
- Hosting：部署成功與 smoke checks。
- 以結構化 log 關聯 requestId、releaseId、buildId；不得記錄 cookie、DB URI、JWT、秘密。

## 5. 備份與災難復原
- M0 免費層不可假設有自動備份/PITR。先驗證官方能力；至少定期 `mongodump` 或應用層 JSON export 至**受限且加密**的備份位置，並演練還原。
- GCS 媒體可啟用 Object Versioning / Soft Delete 或 lifecycle；依成本與誤刪風險決策。
- Hosting 保留前一成功部署版本；CMS Cloud Run 可回滾至前一 revision；schema migration 需兼容回滾。
- RPO/RTO 初期目標：RPO 24h、RTO 4h（待確認）；實測後更新。

## 6. 安全上線門檻

以下為雲端正式上線門檻，於本機 P04-06 UAT 通過後的 Phase 5／6 驗證；不作為本機開發的雲端資源前置條件。本機 gate 仍須驗證 ACL、草稿／媒體隔離、秘密保護、DB／媒體還原及發布回滾。依 ADR-008，雲端限制較晚實測的風險需保留於待驗清單，真實驗收未通過不得上線。
- [ ] 沒有 `0.0.0.0/0` Atlas production allowlist
- [ ] 無憑證進 Git / Docker image / logs
- [ ] 未登入者無法修改任何 collection
- [ ] Draft 文章、媒體及版本不可公開存取
- [ ] DB / GCS 備份及還原演練成功
- [ ] Cloud NAT IP、Cloud Run egress 路徑驗證
- [ ] 依賴套件安全掃描與 image 掃描通過
