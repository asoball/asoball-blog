# 測試策略與驗收

## 階段與放行條件

依 ADR-008，**全部本機開發及 UAT 完成後才上雲測試**。Phase 0～4 不需雲端服務或帳密；P04-06 本機 gate 通過後才啟動 Phase 5。測試分別記錄 local PASS 與 cloud PASS，不能互相替代；雲端待驗不阻擋本機功能開發，但阻擋正式上線。

本機媒體使用 Payload 本機持久化儲存，發布使用本機 snapshot/build/release；可測試替身僅驗證 adapter 呼叫契約，不能當成 GCS、Cloud Build 或 Hosting 真實整合成功。雲端失敗項目須修正並重跑受影響的本機與雲端測試。

## 測試層級
- Unit (Vitest)：slug、日期、DTO mapping、Lexical renderer、SEO、權限 predicates。
- Integration：Payload MongoDB adapter、collections CRUD、draft/version、ACL、GCS storage adapter；本機 Docker MongoDB 可用於早期測試，但**Atlas M0 相容性必須另做雲端驗證**。
- 本機資料庫統一由根目錄 `docker compose up -d --wait --wait-timeout 120` 啟動並保留，測試直接連線；測試前確認 primary 健康，測試後只清理該次 fixture，不停止 DB、不 drop collection/database。不同用途使用獨立 database；PoC 詳見 `poc/p00-01/README.md`。
- E2E (Playwright)：管理者登入→建草稿→上傳圖片→預覽→發布→公開站可讀→取消發布→公開站移除。
- Infra smoke：NAT IPv4、Atlas allowlist、Cloud Run secrets、GCS persistence、Hosting domain/TLS。
- Failure injection：Atlas 暫時不可連、GCS 上傳失敗、Cloud Build 失敗、重複發布、併發發布、Hosting 部署失敗。

## 關鍵測試案例
| ID | 情境 | 預期 |
|---|---|---|
| T01 | 匿名查詢 draft | 403/404 或結果中不存在 |
| T02 | 匿名修改文章 | 401/403 |
| T03 | 重複 slug | 被驗證阻擋 |
| T04 | 上傳非圖片 / 超限檔案 | 被拒絕 |
| T05 | Cloud Run 重啟 | GCS 媒體仍可用 |
| T06 | 文章發布 | 新版頁面、sitemap、RSS 正確 |
| T07 | 取消發布 | 頁面從最新發布版本移除 |
| T08 | Build 失敗 | 舊站保持可用、記錄失敗 |
| T09 | 並發發布 A/B | 不會以舊版覆蓋新版 |
| T10 | Atlas 只允許 NAT IP | CMS 可連、非 allowlist 來源被拒 |
| T11 | Secret 未注入 | 服務 fail closed，不輸出秘密 |
| T12 | MongoDB M0 | 版本、索引、ACL、關聯、媒體功能實測成功 |

## CI 必過
`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；E2E 在合適的 staging 執行。部署 production 前必須有人審核 Terraform plan、權限與費用影響。

本機 E2E 先在 localhost 完整執行，雲端 staging 複驗移至 Phase 5；不以尚無 staging 作為無法開發本機 E2E 的理由。

## 案例與階段對應

| 案例 | P04-06 本機 gate | Phase 5／6 雲端 gate |
|---|---|---|
| T01～T04 | Docker MongoDB + 本機媒體驗證 ACL、slug、MIME／大小 | Atlas／GCS 重跑同等測試 |
| T05 | CMS 本機重啟後媒體仍可用 | P05-05／06 驗證 Cloud Run 重啟與 GCS |
| T06～T09 | 本機發布、取消發布、build 失敗與併發／較舊 release 阻擋 | P05-08 驗證 Cloud Build／Hosting 真實鏈路 |
| T10 | 不適用；僅檢查本機 DB 綁定 loopback | P05-03 驗證 NAT／allowlist／TLS |
| T11 | 本機必要設定缺失 fail closed、無秘密輸出 | P05-06／08 複驗雲端 Secrets／IAM |
| T12 | Docker MongoDB 正式 schema、交易／索引／版本／升級回歸 | P05-04 實測 M0 限制；GCS 媒體另於 P05-05 |
| FE-01～FE-15 | 本機 fixture／snapshot、視覺、axe、鍵盤、無 JS、Lighthouse；人工審核 | 雲端測試站再做 smoke／實際 URL 與快取驗證 |
| 備份／回滾 | P04-04／05 驗證本機 release 與專用 DB／媒體還原 | P05-09、P06-03 驗證 Hosting／Cloud Run／雲端還原 |

## Definition of Done
功能與文件一致、測試可重現、無重大安全問題、沒有秘密外洩、成本影響已註記、更新 ADR/Runbook、附驗收證據。

## 前端專項驗收（必做）
- 依 `FRONTEND_ACCEPTANCE.md` 的 FE-01～FE-15 執行；涵蓋 320/375/768/1024/1440px、Light/Dark、鍵盤、無 JS、TOC、程式碼、SEO、draft 隔離。
- 使用 Playwright screenshot baseline + `@axe-core/playwright`；必要時人工審核視覺差異與焦點操作。
- 效能以固定環境 Lighthouse CI 測量；未測試不得宣稱達標。
