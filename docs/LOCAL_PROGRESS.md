# 本機開發驗收紀錄

最新彙整以 [LOCAL_UAT](LOCAL_UAT.md) 與 [LOCAL_RUNBOOK](LOCAL_RUNBOOK.md) 為準。以下保留早期逐步紀錄；目前已完成 CMS、前台、發布、回滾、Docker 與加密備份，P04-06 自動化及人工本機 UAT gate 已通過。下一個任務 P05-01，雲端尚未執行。

## P00-04

`poc/p00-04` 固定 synthetic published/draft Lexical fixture；`pnpm build`、`pnpm test` PASS。產物只有 published route，Shiki code block 存在、draft canary 不存在。Astro 7.4.5 / Shiki 4.6.0 / Node 22.23.4（pnpm devEngines runtime）。

## P01-01

根目錄 workspace、strict TypeScript、ESLint、Prettier、Vitest、Playwright 設定完成。lint/typecheck 與 runtime check PASS；當時尚無 workspace 功能測試或 app，test/build 為空集合，後續功能測試與 build 結果才是最終驗收證據。PoC 保持獨立鎖檔，不混入正式 workspace。

## P01-02～P01-04

正式 apps/cms 已啟動，Playwright 經官方 Admin 介面登入 PASS。本機 bootstrap 僅由受信任 CLI 執行，憑證在被忽略的 `.local/admin.json`；開發 DB 為 asoball_blog_dev。修正 Windows BOM 與重複 import map 來源後，登入測試穩定通過。

apps/blog 與共用 DTO／fixture、tokens 完成，Astro build、3 項契約測試及 Astro check（0 errors/warnings/hints）PASS。Astro checker 的 wasm-runtime peer 缺漏以固定 packageExtensions 修正，避免 checker 匯入失敗卻以成功退出。官方版本／Node 要求由 npm metadata 與官方文件查核；詳細鎖定於根 lockfile。

PR CI 與 Dependabot 設定完成，Actions 依官方 remote tag 查得的 commit SHA 固定。所有檢查使用本機 Docker 與暫時產生的秘密；真實 GitHub workflow 尚未執行，不宣稱遠端 CI PASS。
