# ADR — 架構決策與待確認事項

## 已決策

- ADR-001：公開前台 Astro SSG + Firebase Hosting；避免 CMS 負擔公開流量。
  - 2026-11-05 使用者再次確認沿用 Firebase Hosting；部署由人員手動執行，操作文件列出 Atlas M0、CMS Cloud Run、private GCS 與所有必要支援資源。未改為前台 Cloud Run 架構；自動內容發布仍依 P05-08 另行整合驗證。
- ADR-002：Payload CMS / Next.js 部署 Cloud Run；不使用 FastAPI。
  - 使用者指定 CMS image 由 Cloud Build trigger 建置。首次 image-only 後由 Console 設定 Run；後續 trigger 可建立不帶流量的候選 revision，人工驗證並選定版本切換流量。此流程與 Astro 內容發布分開，設定檔為 `infrastructure/cloudbuild/cms.yaml`。
- ADR-003：MongoDB Atlas M0 作為雲端 CMS DB；本機先以 Docker MongoDB 完成 PoC 與開發，雲端 M0 實測於本機 UAT 完成後執行（時程依 ADR-008 修訂）。
- ADR-004：GCS 儲存媒體；MongoDB 儲存文章 Lexical JSON/Metadata。
- ADR-005：Cloud Run Direct VPC egress + Cloud NAT 固定出口 IP，Atlas `/32` allowlist。
  - 使用者確認手動部署沿用專案既有 `default` VPC 與同 Region 的既有 subnet，不另建 VPC；NAT 只涵蓋選定 subnet，沿用共用 Router／NAT 前先核對出口與其他服務影響。既有 Terraform 網路資源尚待改為引用模式，本次只調整手冊。
- ADR-006：Cloud Build 發布 Astro，內容快照不可變，部署序列化。
  - 2026-11-12 使用者要求完成 P05-08 自動內容發布：沿用交易 outbox，由 Scheduler 週期啟動 Cloud Run Job，Job 以既有 default VPC／NAT 匯出 private 快照，交專用 Cloud Build 建候選，再持有 DB permit 啟用 Firebase。GCP 內採 runtime ADC，不需外部 GitHub WIF／長期 key；新增 Scheduler／Job／Bucket 用量與 Console 啟用步驟見 [自動發布手冊](CLOUD_AUTO_PUBLISHING.md)。未知遠端結果保持 pending 並對帳，不盲目重發。此為既有技術棧內的實作，不改公開 Astro 靜態模式。

- ADR-007：前台選擇風格 D（Developer Blog 首頁 + Editorial Reading 文章頁 + Documentation TOC），採用設計 tokens 與 RWD/可及性驗收；見 UI_UX_SPEC.md、DESIGN_SYSTEM.md、PAGE_WIREFRAMES.md、FRONTEND_ACCEPTANCE.md。

- ADR-008（2026-11-04，使用者明確決策）：先完成全部本機開發與 UAT，才進行雲端測試。Phase 0～4 採 Docker MongoDB、Payload 本機持久化媒體、本機 immutable snapshot 與發布執行器；不依賴雲端帳密或資源。P04-06 通過後才執行 Phase 5 的資源 plan、建置與雲端複驗。原 P00-02 移至 P05-03、P00-03 移至 P05-05、P00-01 的 M0 部分移至 P05-04；發布流程提前至 Phase 4 在本機完成。正式技術棧不變。權衡：雲端限制會較晚實測，需保留 adapter 邊界、待驗清單及修正回歸時間；雲端驗收不通過不得正式上線。

## 待確認（實作前提出選項）

1. **公開媒體政策**：草稿圖片是否允許被持有 URL 的人讀取？預設採不公開；需設計正式發布圖片的公開路徑。
2. **CMS 網域**：`admin.example.com` 是否為正式域名？若尚未購買可先使用 Cloud Run URL。
3. **Markdown 需求**：v1 以 Lexical 編輯；若需 Markdown 原始檔，須設計匯出與轉換。
4. **MongoDB M0 限制**：免費層備份、交易、聚合、索引、網路、連線數等依當前官方文件及 PoC 決定。
5. **可靠發布鎖**：只使用單一 Cloud Build trigger 不等於全域序列化；需明確選定 atomic release state 與部署順序控制方案。
6. **內容快照存取**：Cloud Build 使用專用 export script / API 時的身分驗證、Atlas NAT 網路路徑及額外成本。
7. **版本升級策略**：Payload/Next.js/Astro/Node 版本與 MongoDB Atlas 版本相容性。
8. **資料備份**：M0 的可用備份能力不足時，採定期匯出與還原演練。

## 已知權衡

- 本機發布實作：以既有 MongoDB 交易 outbox、遞增序號、租約 fencing 與短時間檔案鎖實現去重及序列化，不新增付費佇列服務。私有原始媒體維持管理者 ACL；只將 published 引用的最佳化 WebP 複製到不可變快照。沒有 Git checkout 時記錄原始碼 SHA256；雲端仍強制固定 Git commit。
- 雲端啟用契約：遠端 activation 前持久化 pending permit，遠端結果未知時阻擋後續 publisher，不能盲目重試；真實 IAM／遠端結果對帳在 Phase 5 驗證。
- 2026-11-05 安全修補：Payload 維持 3.92.1；其 peer 支援 Next >=16.3.3 <17，鎖定 Next 16.4.5。Sharp 鎖定 0.35.5，透過受型別檢查的 byte-buffer adapter 對接 Payload 舊輸入契約；DOMPurify 3.4.17、Happy DOM 21.0.4 固定 override，需完整 CMS／媒體回歸。這是既有技術棧的安全維護，未更換框架。仍有 uuid moderate、deepmerge low 的上游 advisory，記錄於 UAT，不宣稱零漏洞。

- 本機開發（2026-11-04，使用者指定）：MongoDB 採根目錄 Docker Compose 共用常駐單節點 replica set 與具名 volume；本機測試直接連線，不再使用 mongodb-memory-server。Atlas M0 仍為正式環境決策，本機成功不替代 M0 驗收。
- 固定出口 IP 帶來持續 NAT/IP 成本，但降低 Atlas IP Access List 暴露面。
- CMS scale-to-zero 降低運算費用，但冷啟動會延遲首次後台載入。
- Payload Lexical 提供現成編輯體驗，但非 Markdown 原始格式。
- M0 降低資料庫費用，但性能、容量、備份與高可用性受限。
