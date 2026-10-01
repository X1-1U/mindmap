# 思維導圖

一套程式碼，同時支援 Mac、Windows、Linux、iOS、Android 的思維導圖 App。

## 功能

- **編輯**：選中主題後，旁邊的 + 新增子主題、× 刪除；中心主題左右各一個 +，可以分別往左、往右長
- **底線備註**：主題右側可以加一行底線文字
- **名詞標註**：編輯時選取一個詞（例如 BTC）標註成藍色，點一下就顯示維基百科的解釋；一詞多義時可以自己選意思，解釋會存進檔案，離線也看得到
- **快速輸入**：貼上一段條列文字或 Markdown，自動長成子主題；拖曳主題可以換位置；支援復原、重做
- **開啟別人的檔案**：`.mindmap`、JSON、Markdown、OPML、純文字、本 App 匯出的 HTML；可以選「預覽（唯讀）」或「轉換成可編輯」
- **分享與匯出**：
  - HTML 分享檔：對方用任何瀏覽器都能打開，可以縮放、看名詞解釋
  - PNG 圖片
  - Markdown 大綱、OPML 大綱
  - `.mindmap` 完整備份
- **手機操作**：雙指縮放、連點兩下編輯、底部操作列

## 下載

到 [Releases](../../releases) 頁面下載各平台的安裝檔。

## 快捷鍵（電腦版）

| 按鍵 | 功能 |
|---|---|
| `Tab` | 新增子主題 |
| `Enter` | 新增同級主題 |
| `Space`／雙擊 | 編輯文字 |
| `N` | 新增或編輯備註 |
| `Delete` | 刪除主題 |
| `/` | 摺疊或展開 |
| 方向鍵 | 切換選取 |
| `⌘Z`／`⇧⌘Z` | 復原／重做 |
| `⌘O`／`⌘N` | 開啟檔案／新建導圖 |

## 檔案格式

`.mindmap` 是 JSON 格式：

```json
{
  "format": "mindmap",
  "version": 1,
  "root": { "id": "…", "text": "中心主題", "children": [ { "id": "…", "text": "想法", "note": "備註", "side": "R", "children": [] } ] },
  "terms": { "BTC": { "title": "比特幣", "extract": "…", "url": "https://zh.wikipedia.org/wiki/…" } }
}
```

## 開發

技術：[Tauri 2](https://tauri.app)（Rust 外殼）＋ TypeScript ＋ Vite，沒有使用前端框架。

需要的工具：Node.js（LTS）、Rust；iOS 另外需要 Xcode 和 XcodeGen，Android 需要 Android Studio 和 NDK。

```bash
npm install
npm run tauri dev          # 電腦版（開發模式）
npm run tauri build        # 電腦版安裝檔
npm run tauri ios dev      # iOS 模擬器
npm run tauri android dev  # Android 模擬器
```

只想在瀏覽器裡改介面的話：`npm run build:viewer && npm run dev`，然後打開 http://127.0.0.1:1420 。

### 程式結構

| 檔案 | 內容 |
|---|---|
| `src/editor.ts` | 導圖畫布：排版、編輯、拖曳、縮放、名詞卡片 |
| `src/main.ts` | 首頁、編輯畫面、開檔與匯出流程 |
| `src/formats.ts` | 各種格式的匯入與匯出 |
| `src/export.ts` | PNG 與 HTML 分享檔 |
| `src/platform.ts` | 存檔、開檔對話框（App 版用檔案，網頁版用瀏覽器儲存） |
| `src/terms.ts` | 維基百科查詢 |
| `src/viewer/` | HTML 分享檔裡的唯讀檢視器 |
| `src-tauri/` | Tauri 設定與 Rust 外殼 |
| `docs/prototype.html` | 最早的單檔原型 |

### 發布新版本

修改 `src-tauri/tauri.conf.json` 和 `package.json` 裡的版本號，然後推送標籤，GitHub Actions 會自動打包並放到 Releases：

```bash
git tag v0.2.0
git push origin v0.2.0
```
