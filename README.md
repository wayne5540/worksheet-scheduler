# 門市排班系統

單人使用、純前端的門市排班 SPA。專案使用 React、TypeScript 與 Vite，設定資料儲存在瀏覽器 `localStorage`，月度班表等較大資料儲存在 IndexedDB。

## 環境需求

- Node.js `>=22.13.0`
- npm `>=10.9.0`

建議使用專案指定的 npm lockfile 安裝依賴：

```bash
npm ci
```

## 開啟本機開發版

啟動 Vite dev server：

```bash
npm run dev
```

終端機會顯示本機網址，通常是：

```text
http://localhost:5173/
```

用瀏覽器打開該網址即可使用。若 `5173` 已被占用，Vite 會自動改用其他 port，請以終端機實際顯示的網址為準。

## 測試與驗證

跑一次完整測試：

```bash
npm run test -- --run
```

開發時用 watch mode：

```bash
npm run test
```

檢查 ESLint：

```bash
npm run lint
```

確認 production build 可產生：

```bash
npm run build
```

提交前建議跑完整驗證；這會依序執行 lint、測試、build 與 workflow 檢查：

```bash
npm run verify
```

## Debug JSON 分析

若要分析 app 內「匯出 Debug JSON」取得的排班狀態，可以執行：

```bash
npm run debug:analyze -- /path/to/work-schedule-debug.json
```

這個指令會使用專案內的 TypeScript 規則 validator 重新檢查匯出的月班表，列出可排人力摘要、啟用規則、產生時放寬的規則，以及目前班表實際違反的規則。

## GitHub Pages 部署

本專案已加入 GitHub Actions workflow，push 到 `master` 後會建置並部署到 GitHub Pages：

```text
https://wayne5540.github.io/worksheet-scheduler/
```

Vite build 會在部署 workflow 中使用 `--base=/worksheet-scheduler/`，避免 GitHub Pages 專案網站的靜態資源路徑 404。

若第一次部署沒有自動發布，請到 GitHub repo 的 Settings > Pages，將 Build and deployment 的 Source 設為 `GitHub Actions`，再重新執行 `Deploy GitHub Pages` workflow。

## 資料重置

本 app 會使用瀏覽器的 `localStorage` 與 IndexedDB 保存資料。若要清掉本機測試資料，可以在瀏覽器 DevTools 的 Application 面板中清除目前網站的 Storage，或直接清除該 localhost 網站資料。
