# Design System — Tech Blog v1.1

設計方向：現代 Developer Blog 首頁 × Editorial 文章閱讀 × Documentation TOC。使用 Tailwind CSS + CSS custom properties；token 名稱是唯一設計來源。

## 1. 色彩 Tokens
| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--bg` | `#FFFFFF` | `#0B0F17` | 頁面背景 |
| `--surface` | `#F8FAFC` | `#151B26` | 卡片/浮層 |
| `--surface-hover` | `#F1F5F9` | `#1D2634` | hover |
| `--text` | `#0F172A` | `#F1F5F9` | 主文字 |
| `--text-muted` | `#475569` | `#CBD5E1` | 次要文字 |
| `--border` | `#CBD5E1` | `#475569` | 邊框/分隔 |
| `--accent` | `#1D4ED8` | `#93C5FD` | 連結/重點 |
| `--accent-hover` | `#1E40AF` | `#BFDBFE` | hover |
| `--focus` | `#2563EB` | `#93C5FD` | 焦點輪廓 |
| `--code-bg` | `#F1F5F9` | `#111827` | code 區塊 |

- 文字/背景需以實際組合測試 WCAG AA（一般文字 >=4.5:1、大字 >=3:1）；不可只因 token 表格就假設全部組合合格。
- 成功/警示/錯誤顏色只用於實際狀態，不作裝飾；訊息不可只靠顏色區分。
- 不使用漸層大背景、霓虹、玻璃擬態作為全站預設。

## 2. 字型與排版
- 系統優先、避免外部字型請求：`Inter`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Noto Sans TC`, `sans-serif`；程式碼 `ui-monospace`, `SFMono-Regular`, `Consolas`, `monospace`。
- 若決定下載自託管字型，需記錄授權、檔案大小及效能影響；v1 不強制下載字型。
- Base 16px；行高 1.7（中文閱讀）；正文 desktop 18px/1.85，mobile 16px/1.8。
- H1 desktop 44px/1.2，mobile 32px/1.25；H2 30px/1.3（mobile 26px）；H3 23px/1.4（mobile 21px）。
- 文章標題字重 700；正文 400；次要資訊 400–500；英數與繁中混排避免過密 letter-spacing。
- 正文段落間距 1.25em；H2 上間距 2.25em、下間距 0.75em；H3 上間距 1.7em。
- 行內連結應有底線或其他非顏色辨識方式；hover 保持可辨識。

## 3. 尺寸與空間
- Spacing scale（px）：4、8、12、16、20、24、32、40、48、64、80、96。
- Layout max width 1200px；article prose max width 720px；TOC width 220px；gutter 48px。
- 圓角：`sm=6px`, `md=10px`, `lg=14px`, `xl=20px`；卡片預設 14px。
- Header desktop 72px / mobile 64px；footer 上下 padding 48–64px。
- 卡片內距 desktop 24px / mobile 20px；列表間距 24px。
- Border 1px；陰影低對比、只用於必要浮層，不讓每張卡片有厚重陰影。

## 4. 元件狀態
| 元件 | Default | Hover/Focus | Disabled/Empty |
|---|---|---|---|
| Link | accent + underline | hover accent + focus ring | 不適用 |
| Button | 實心 accent 或 outline | 明顯背景/輪廓變化 | 降低強調但仍可讀，原生 disabled |
| ArticleCard | surface + border | 邊框/標題變化 | 不產生空卡 |
| Tag | surface、圓角 | hover border/accent | 不適用 |
| TOC item | muted text | active accent + 左邊框 | 無章節則隱藏 |
| Code copy | 清楚標籤/圖示 | focus ring | Clipboard 不支援時提供 fallback |

## 5. 技術內容專用
- CodeBlock：等寬 13–14px、line-height 1.6、padding 20–24px；可橫向捲動；長行不強制換行以保留程式碼結構。
- 語法高亮使用 Shiki，light/dark 雙主題；避免整個頁面為了 code block 載入重型 client runtime。
- 表格：header 區分、單元格 padding 12–16px、橫向容器可捲動，保留可及性 caption（若有）。
- 引言：左邊框 accent、內距 20px、字體與正文一致；避免將引用當裝飾。
- Callout：info/warning/success 三種語意類型；v1 可先不做，不能把未支援 Lexical 節點默默丟失。
- 圖片：最大寬度 100%、高度 auto、圖說 14px muted；封面建議 16:9，缺圖時使用純色排版，不使用隨機網路圖。

## 6. Motion
- 過渡 120–180ms，僅 opacity/color/border/transform 微幅變化；`prefers-reduced-motion: reduce` 停用非必要動畫。
- 主題切換不閃爍；避免首屏 CLS。

## 7. 實作規範
- Tokens 定義於 `apps/blog/src/styles/tokens.css`，Tailwind theme 對應同一組變數。
- 只允許一套全站 typography/prose 樣式，避免每頁自行調整標題與段距。
- 不得在多個元件中硬編碼不同 hex/間距；如需新增 token，更新本文件與視覺測試。
- 預設無品牌 Logo 圖片；使用可配置文字站名。站名、個人簡介、社群連結放在 `site.config.ts`，不得杜撰真實資訊。
