# Phase 0～4 本機驗收

驗證日期：2026-11-05。範圍僅本機；不包含真實 Atlas M0、GCS、Cloud Run、NAT、Cloud Build、Hosting 或 WIF。使用者已核准共用元件風格、完整 30 張頁面 baseline，並明確回覆「接受本機 UAT，Phase 4 可結案」。**P04-06 本機 gate 已通過。**

## 任務與證據

| 範圍 | 實作及驗收證據 | 狀態 |
|---|---|---|
| P00-01、P00-04 | Docker replica set、Payload CRUD／交易／版本／索引／ACL；Astro published fixture 與 Shiki PoC | PASS |
| P01-01～04 | pnpm workspace、strict TS、lint／format、Vitest、Playwright、官方 CMS 與 Astro、PR CI／Dependabot 設定 | 本機 PASS；遠端 CI 未執行 |
| P02-01～02 | Users／Posts／Categories／Tags／Media、唯一與不可變 slug、關聯保護、draft／restore、匿名 ACL | PASS |
| P02-03 | 官方 Lexical code block、SEO、Admin 編輯與儲存草稿、登入保護的 no-store 預覽 | PASS |
| P02-04 | 真實圖片 bytes／MIME／5MB 限制、私有檔案 ACL、alt、published 複製媒體；GCS 官方 adapter 設定契約 | 本機 PASS；真實 GCS 待 P05-05 |
| P03-00～03 | 設計 tokens／共用元件／靜態頁／renderer／TOC／copy／SEO／RSS／404 | PASS |
| P03-04 | 30 張人工核准 baseline；axe／鍵盤／無 JS／RWD／Lighthouse | PASS |
| P04-01 | admin 與 DB 身分驗證、交易快照、published DTO、欄位裁剪、引用圖片 WebP、immutable snapshot | PASS |
| P04-02 | transactional outbox、去重／合併、遞增序號、單一租約、fencing、重試／crash resume | PASS |
| P04-03 | 真實 Astro publish／update／unpublish／delete、feeds 與靜態產物掃描；HTTP 鏈路 | PASS |
| P04-04 | build 失敗保留舊站、stale build 阻擋、產物完整性、原子回滾、cloud pending 阻擋、adapter 契約、Terraform fmt／validate | PASS；真實雲端未執行 |
| P04-05 | 非 root multi-stage image、runtime secrets、登入／上傳／restart persistence；AES-GCM DB／媒體備份、錯誤 key 與非空目標拒絕 | PASS |
| P04-06 | 全部自動化與人工本機 UAT gate | PASS；使用者已接受本機 UAT |

## 指令紀錄

### 後續：本機／雲端環境相容準備

已修正 UBLA 物件 ACL 衝突，加入 local／cloud 設定驗證、自訂 Atlas DB、獨立 env 檔、雲端 bootstrap Email、設定檢查 CLI 與本機維運命令的 cloud 防呆。`pnpm lint`、`pnpm typecheck`、`pnpm test`（31 tests）、`pnpm test:integration`、`pnpm test:queue`、`pnpm test:publishing`、`pnpm test:backup`、`pnpm build` 通過；local 與假資料 cloud 的離線 config check 通過。測試使用 Docker MongoDB／替身／離線假設定，沒有連接真實 Atlas／GCS。使用者回報 Console 建置完成至手冊 3.5，不因此將 Phase 5 真實服務驗收勾選完成。

後續修正（2026-11-05）：publisher 啟動時遇到已持有的租約，改為正常回報 busy；持續 worker 重試初始化，單次執行不搶鎖。新增真實 MongoDB 雙 publisher 與 CLI busy 回歸，以及 active.json 缺失後恢復測試。`pnpm build` 已重新通過，其本身不呼叫 publisher。

| 命令 | 結果 |
|---|---|
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS；Astro 0 errors／warnings／hints |
| `pnpm test` | PASS：7 files、13 tests |
| `pnpm test:integration` | PASS：CMS／snapshot／媒體、ACL、索引、restore |
| `pnpm test:queue` | PASS：dedupe／coalescing／single worker／fence／resume／retry／crash retry exhaustion |
| `pnpm test:publishing` | PASS：含 heartbeat 與 CMS 同時寫入、停用交易拒絕、outbox rollback、publish／update／unpublish／delete、retry、stale rejection、rollback |
| `pnpm test:backup` | PASS：加密 DB／media、wrong key、還原資料與非空拒絕 |
| `pnpm build` | PASS：Astro 26 HTML pages、Next production routes |
| `pnpm test:e2e` | PASS：12 passed、1 skipped（已完成的首次截圖審核產生器）；包含 CMS UI／私有圖片預覽／HTTP publishing／30 baseline／axe |
| `pnpm exec playwright test publishing-http.spec.ts --workers=1 --repeat-each=3` | PASS：3／3，修正後重複驗證發布、去重、取消發布與匿名拒絕 |
| `pnpm test:lighthouse` | PASS：首頁／文章各 3 次；Performance 100、Accessibility 100、Best Practices 96、SEO 100；LCP 900～960ms、CLS 0～0.003733 |
| Terraform 1.13.5 Docker `fmt -check`／`validate` | PASS；未執行 plan／apply |
| `pnpm audit --prod --audit-level=high` | PASS，0 high／critical；保留 1 low、2 moderate |
| MongoDB 中斷可用性 | PASS：停止 Docker MongoDB 後，fixture 4322 與已發布 release 4330 仍回傳 200；隨後恢復 DB healthy |

## FE／安全映射

FE-01／07：blog-routes；FE-02／03／13：components、axe；FE-04／05／06：blog-reading；FE-08／09：snapshot／publishing integration 與 artifact scan；FE-10／12／14／15：visual；FE-11：renderer malicious／unknown-node unit tests。視覺涵蓋 320／375／768／1024／1440 × light／dark × 首頁／文章／分類，baseline 位於 `apps/blog/tests/visual/baseline/win32/`。

T01～04：CMS integration／security／media；T05 本機對應：Docker restart media smoke；T06～09：publishing integration／HTTP；T11：environment unit 與 runtime secret 檢查；T12 本機對應：Docker 正式 schema。T10 與 T12 真實 M0、T05 真實 Cloud Run／GCS 保留 Phase 5，不冒充通過。

## 限制與待確認

- P04-06 人工確認已收到；本機 UAT 與視覺 baseline 均由使用者明確接受。
- 實驗室 Lighthouse 不能替代真實使用者 INP／流量數據；後續部署再收集。
- Windows baseline 已核准；Linux／其他字型環境需人工審核其 baseline。GitHub workflow 尚未遠端執行。
- 上游 GCS adapter 的 uuid 8／9 有 moderate bounds-check advisory；Payload deepmerge 4.3.1 有 low advisory 尚無修補版本。未任意強制替換其 major API；不得宣稱零漏洞。
- LHCI 間接依賴有 proxy-agent peer warning；本機 Chromium／Lighthouse 實際執行驗證。主機全域 Node 20 的 pnpm engine 提示與 pnpm runtime 22 腳本區別見操作手冊。
- 沒有 Git repo，無 commit／PR；本機 release 記錄 source SHA256，雲端須固定 commit。
- 回歸曾發現共用 Astro cache 干擾，已改為每個 release 獨立 cache；另發現 CMS 內容交易與 worker heartbeat 共用 state 的 write conflict，已提前取得 transaction state write lock，加入同步競爭回歸。保留失敗紀錄，修正後才放行。
- 雲端設定已在本機完成契約／語法驗證，但 IAM、TLS、M0 配額、remote activation 對帳與費用仍待 Phase 5。

## 實作檔案範圍

- `apps/cms/src/`：collections／ACL／Lexical／私有 preview／媒體驗證／同交易 publishing hooks／狀態 API；`apps/cms/Dockerfile`、`next.config.mjs`：production 與容器建置。
- `apps/blog/src/`、`astro.config.mjs`：Design tokens、元件、列表／文章／分類／標籤／About／404、TOC、主題、SEO、隔離建置 cache。
- `packages/content-contract/`：公開 DTO／Zod／fixture／安全 renderer；`packages/publishing/`：snapshot／queue／worker／rollback／cloud adapter。
- `scripts/`：setup／bootstrap／seed／integration／發布／靜態 server／備份還原／Lighthouse；`tests/` 與 `apps/blog/tests/visual/`：unit、E2E、人工核准 baseline。
- `compose.yaml`、`infrastructure/`、`firebase.json`、`.github/workflows/`：本機 Docker、雲端設定與契約、CI；`docs/`：規劃、相容性、操作與本驗收證據。

所有本機資料與憑證由 ignore 排除；測試只清理由該測試建立的記錄，不 drop DB／collection。未新增付費服務、未建立雲端資源、未更動遠端 IAM、未部署。

操作與資料保護流程見 [LOCAL_RUNBOOK](LOCAL_RUNBOOK.md)。下一個任務為 P05-01（雲端設定與 plan 審查）；本次不啟動 Phase 5，未授權不建立或部署雲端資源。
