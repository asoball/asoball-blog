# P00-01 相容性與驗證紀錄

查核日期：2026-11-04。狀態：**P00-01 本機 PoC 已完成；Atlas M0 複驗另列 P05-04，尚未執行**。依 ADR-008，先完成全部本機開發及 P04-06 UAT，再進行雲端測試。此紀錄不代表雲端驗收或正式部署完成。

## 版本矩陣

以下表格保留 P00-01 當時版本，獨立 PoC 未直接升級。正式 workspace 於 2026-11-05 的安全回歸版本：Payload 全家族 3.92.1、Next 16.4.5（peer `>=16.3.3 <17`）、React 19.3.1、Astro 7.4.5、Tailwind 4.3.4、Shiki 4.6.0、Sharp 0.35.5、MongoDB Node driver 6.20.0、MongoDB Docker 8.0.16、Node 22.23.4。依根目錄 lockfile 為準。

原生 MongoDB driver 與 Payload 使用的 BSON major 必須一致；曾以 driver 7 對接 Payload session 造成 BSONVersionError，已鎖回 6.20.0 並通過同交易 outbox。Sharp 新版收斂輸入型別，以 byte-buffer adapter 連接 Payload 舊契約；packageExtension 明確讓 Payload 型別參照相同 Sharp。DOMPurify 3.4.17、Happy DOM 21.0.4 由安全 override 固定。

查核來源：[Payload 官方安裝／相容性](https://payloadcms.com/docs/getting-started/installation)、各版本 npm peerDependencies、[Next 官方安全公告](https://github.com/vercel/next.js/security/advisories)、[Sharp 官方](https://sharp.pixelplumbing.com/)。Next 舊版存在 [ImageResponse RCE 公告](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j)；已更新正式 workspace 並重新測試，歷史 PoC 僅保留隔離相容性證據，不可當部署來源。

| 元件 | PoC 鎖定版本 | 相容性依據 |
|---|---|---|
| Node.js | 22.23.4 | Payload npm engines：`^22.23.4 || >=24.22.1` |
| pnpm | 10.34.9 | 獨立 PoC packageManager 宣告 |
| Payload / db-mongodb / next adapter | 3.92.1 | 同版本；adapter peer 精確要求 payload 3.92.1 |
| Next.js | 16.3.3 | @payloadcms/next peer：`>=16.3.3 <17.0.0`，另有部分 Next 15 支線 |
| React / React DOM | 19.3.1 | Next 16.3.3 接受 React `^19.0.0` |
| TypeScript | 5.9.3 | strict；typescript-eslint peer 範圍內 |
| MongoDB Docker 單節點 replica set | 8.0.16 | 官方 `mongo` image；常駐具名 volume，不能推論 Atlas 實際 patch version |
| Atlas Free（M0） | 未建立／未連線 | 官方文件列 MongoDB 8.0；實際版本待連線驗證 |

原環境 Node 20.19.0、無 pnpm。驗證透過 npx 指定 Node / pnpm 執行，沒有修改全機安裝。PoC 的直接依賴與遞迴解析均已鎖檔。只允許 esbuild 安裝 script。依使用者要求，本機改由 Docker Compose 共用 MongoDB；已移除 mongodb-memory-server，測試不再下載或管理 MongoDB binary。

## 官方依據與差異

- [Payload installation](https://payloadcms.com/docs/getting-started/installation)：Node 要求與 Next 整合方式。
- [Payload MongoDB adapter](https://payloadcms.com/docs/database/mongodb)：官方 adapter、連線選項及 Mongoose models 存取。
- [Payload transactions](https://payloadcms.com/docs/database/transactions)：本 PoC 保持預設交易，不以停用交易掩蓋失敗。
- [Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)：500 connections、有限儲存、聚合不可寫入暫存磁碟等限制。連線池先限制 5；真正應用負載仍待測。
- [Payload 官方 blank template](https://github.com/payloadcms/payload/tree/v3.92.1/templates/blank)：PoC 的 Next Admin / REST 路由依官方整合模式建立。

查核時 installation 頁對 Next 16 的最低版本與 npm peerDependencies 有差異；本 PoC 採兩者交集，鎖定 16.3.3。正式升級必須重新比對，不可直接安裝 latest。

## 驗收與升級門檻

2026-11-04 本機執行結果（工作目錄 `poc/p00-01`；透過指定版本的 npx Node / pnpm 執行）：

| 命令／案例 | 結果 |
|---|---|
| `pnpm install --frozen-lockfile` | PASS，鎖檔重現安裝成功 |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | PASS，6 個環境防護案例 |
| `pnpm test:local` | PASS，直接連 Docker MongoDB 8.0.16 replica set；重啟前後各成功一次，預設交易啟用 |
| `docker compose config --quiet`、`pnpm db:up`、`pnpm db:status` | PASS，primary healthy，host 僅綁定 127.0.0.1:27017 |
| Docker 重啟與資料保留 | PASS，驗證文件跨重啟及整合測試仍存在，最後僅刪除該驗證文件 |
| 登入、CRUD、關聯、實際唯一索引、重複 slug 拒絕 | PASS |
| 草稿隱藏、發布／取消發布、版本讀取及還原 | PASS |
| 匿名建立文章／讀取版本／讀取 Users | PASS，拒絕存取 |
| `pnpm build` | PASS；Admin 與 REST 為動態路由，未連接 Atlas |
| `pnpm format:check` | PASS；已排除建置產物 |
| 真實 Atlas M0、瀏覽器 Admin 人工驗收 | NOT RUN |

Build 僅使用本機 loopback URI 與非正式 placeholder secret；此結果只代表能編譯，不代表資料庫可連線。未安裝 email adapter 的本機警告屬預期；PoC 不驗證寄信。本目錄目前不是 Git repository，無法執行 git diff / status，未自動建立 Git 或提交。

Docker 設定為根目錄 `compose.yaml`，image 固定版本及 digest；健康檢查只初始化尚未設定的 replica set，等待可寫 primary。具名 volume `asoball-blog_mongodb-data` 保留手動資料；測試完成後容器持續 healthy。未使用帳密／TLS，限本機開發，正式環境仍採 Atlas。Docker Desktop / Engine 的本次版本為 4.27.2 / 25.0.3，Compose 2.24.5。只有 image 下載、本機磁碟與 CPU／記憶體成本，無新增雲端月費。

執行方法見 [PoC README](../poc/p00-01/README.md)。正式資料模型仍未開始；PoC 僅含 Users、Categories、Posts 的最小測試 schema。

Atlas 驗收移至 P05-04，屆時需專用 M0、測試帳號、來源 IP `/32` allowlist 與受保護的連線設定。需以屆時正式 schema 重跑整合測試與 Admin 操作，記錄實際 MongoDB 版本、索引、版本資料及受限操作結果。本機 P00-01 已依現有測試證據勾選，不再等待 M0，也不代表 P05-04 已通過。

升級時先匯出測試資料，再於專用 DB 更新並比對索引、CRUD、draft/version、restore 與 ACL。PoC 不 drop collection/database，不建立雲端資源、不更動 IAM；本機測試只有磁碟與下載成本。
