# Data & API Contract

## 1. Payload Collections

### Users
- email (unique)、password（Payload Auth）、role: admin；禁止公開註冊。
- admin 角色可以管理內容與媒體；只有授權管理者能觸發發布。

### Posts
- title: string required, max 160
- slug: string required, unique, lowercase kebab-case, immutable after publication unless明確處理 redirect
- excerpt: string max 300
- content: Lexical rich text required
- coverImage: relationship Media nullable
- category: relationship Categories nullable
- tags: hasMany relationship Tags
- seoTitle: string nullable, seoDescription: string nullable
- publishedAt: date nullable
- `_status`: Payload drafts enabled (`draft`/`published`)
- versions: enabled, capped to avoid M0 容量膨脹
- createdAt/updatedAt: automatic

### Categories / Tags
- name required; slug unique; description optional；關聯刪除須處理。

### Media
- upload collection; alt required; MIME whitelist image/jpeg,image/png,image/webp,image/avif; size limit configurable (MVP 5MB)；GCS adapter。
- 本機階段使用 Payload 本機 upload 與持久化目錄／volume，沿用同一存取契約；草稿檔案不得由公開靜態目錄直出。P04-06 通過後，於 P05-05 切換官方 GCS adapter 並複驗，不要求本機開發時連接 GCS。

### Deployments（可選）
- releaseId、trigger、commitSha、snapshotPath、state(queued/running/succeeded/failed)、startedAt、finishedAt、buildId、hostingVersionId、errorSummary。
- 避免用此 collection 當分散式鎖的唯一機制；部署鎖需原子性與重試設計。

## 2. 存取控制
- Users：匿名完全禁止；僅 admin 存取。
- Posts：匿名只允許 `_status=published`，不可取得 drafts/versions/未發布關聯；管理者 CRUD。
- Categories/Tags：匿名只讀；admin 寫入。
- Media：公開僅已發布資源，草稿媒體不可匿名讀取；可採「公開媒體/私人草稿媒體」分離或明確接受未發布圖片公開的產品政策，必須先決策。
- Hooks / Local API 不能假設自動套用同等 ACL；在程式碼明確驗證 caller 身分及 overrideAccess 行為。

## 3. 公開內容 DTO（Astro 使用）
```ts
export interface PublicPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: unknown; // validated Lexical JSON, transformed by renderer
  category?: { slug: string; name: string };
  tags: { slug: string; name: string }[];
  cover?: { url: string; alt: string; width?: number; height?: number };
  publishedAt: string;
  updatedAt: string;
  seo: { title: string; description: string; canonicalPath: string };
}
```
匯出時使用 Zod 驗證 DTO，明確白名單欄位；不允許帶出 Users、password hash、draft、內部檔案路徑。

## 4. API
優先使用 Payload 內建 REST/Local API；不要重造通用 CRUD。自訂 API 僅限：
- `POST /api/publishing/request`：admin only；建立/合併發布請求；回傳 releaseId。
- `GET /api/publishing/:releaseId`：admin only；查詢部署狀態。
- `GET /api/health`：非敏感 liveness；不得輸出 secrets。
- 內容匯出建議使用 **Cloud Build 專用身分認證** 的受保護 endpoint，或由 Cloud Build 執行受控 export script；不得把 draft API 公開。

## 5. Lexical 技術文章區塊
先使用 Payload 預設 Lexical 編輯器，增加 code block 與語法標記；Mermaid、KaTeX 作為可選自訂 block，編輯器/renderer/安全測試必須成對實作。外部 HTML 預設禁止或經嚴格 sanitize。

## 6. Slug / Redirect
`/posts/<slug>/`；slug 變更需記錄 redirect 映射，v1 可先禁止 published slug 修改，避免 404。
