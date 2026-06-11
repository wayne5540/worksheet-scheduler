# AI Collaboration Guide

本專案會由多個 AI agent 與人類共同開發。所有 agent 在開始工作前，都必須先閱讀：

1. `PLAN.md`
2. `PROGRESS.md`
3. `docs/DEVELOPMENT_WORKFLOW.md`
4. 最近的 git history：`git log --oneline --decorate -n 10`

`CLAUDE.md` 與 `GEMINI.md` 都是指向本檔的 symlink。請不要把它們改成獨立檔案；需要更新協作規則時，直接編輯 `AGENTS.md`、`CLAUDE.md` 或 `GEMINI.md` 皆可。

## Project Direction

- 產品：單人使用、純前端的門市排班 SPA。
- 語言：使用者介面與文件以繁體中文為主。
- 預設技術方向：React + TypeScript + Vite。
- 儲存策略：設定放 `localStorage`，月度班表等較大資料放 `IndexedDB`。
- 排班核心：獨立規則 validator + backtracking / constraint propagation，避免把演算法邏輯綁死在 UI component 中。

## Development Rules

- 優先使用最新且穩定的套件版本；新增或升級套件前，查 npm registry / 官方文件，避開 prerelease、deprecated、或與目前 Node 版本不相容的版本。
- 可以參考 open source 解法的架構與測試策略，但不要直接引入過重框架或為尚未出現的需求設計大型抽象。
- 任何功能或修正都先寫測試，再寫最小實作，最後重構。
- 每個小改動都要 commit。commit message 必須包含：
  - Title: 第一行摘要
  - Why: 為什麼需要這個改動
  - How: 怎麼做
  - Goal: 這個改動的目標
  - Result: 實際結果
- 每次 commit 前都要確認 `PROGRESS.md` 已反映目前狀態；如果完成了 checklist 項目，要在同一個 commit 中勾選。
- 不要依賴 AI 對話上下文保存狀態。可持久化的資訊要寫回文件、測試、程式碼或 commit history。

## Handoff Checklist

交接或結束工作前，請確認：

- `npm run verify` 通過，或在回覆中說明無法通過的原因。
- `PROGRESS.md` 的 Done / In Progress / Todo 與實際狀態一致。
- 新增的技術決策已寫入 `docs/DEVELOPMENT_WORKFLOW.md` 或更貼近該決策的文件。
- 每個 commit 都是可理解、可回溯的小單位。
- 若發現 PLAN 與實作衝突，先更新或提出文件差異，不要默默改變產品需求。
