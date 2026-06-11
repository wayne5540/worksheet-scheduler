# Development Workflow

本文件定義人類與 AI agent 的共同開發流程。目標是讓專案即使由不同 AI 接手，也能保持一致的節奏、可驗證的品質與清楚的進度。

## Source Of Truth

- `PLAN.md`：產品規格與需求範圍。
- `PROGRESS.md`：目前已完成、正在做、尚未完成的 checklist。
- `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`：AI 協作規則。`CLAUDE.md` 與 `GEMINI.md` 必須是指向 `AGENTS.md` 的 symlink。
- git commits：每個小改動的永久紀錄。

## Package Policy

新增或升級套件時：

1. 查 npm registry 或官方文件，確認使用 latest stable。
2. 避開 alpha、beta、rc、next、canary 等 prerelease，除非 `PLAN.md` 或 issue 明確要求。
3. 確認套件 engine requirement 與本專案 Node 版本相容。
4. 優先選用生態成熟、維護活躍、可被測試覆蓋的套件。
5. 只有在能降低實作風險或明顯簡化維護時才加套件。

目前基準：

- Node: `22.22.2`
- npm: `10.9.7`
- Package manager: npm with `package-lock.json`
- App stack: React `19.2.7`, Vite `8.0.16`, TypeScript `6.0.3`, Vitest `4.1.8`
- IndexedDB tests: `fake-indexeddb` `6.2.5` as a dev-only browser API emulator
- Excel export: `write-excel-file` `4.1.1`; npm `xlsx@0.18.5` was avoided because `npm audit` reported high severity advisories with no npm fix available

## TDD Loop

所有功能開發遵循：

1. Red：先寫能描述需求的 failing test。
2. Green：寫最小實作讓測試通過。
3. Refactor：在測試保護下整理命名、邊界與結構。

測試重點：

- 規則 validator 與排班演算法需要純函式測試。
- UI component 測試只覆蓋使用者可觀察行為。
- 匯出 Excel 需要針對工作表結構與關鍵欄列做測試，不只測是否有檔案產生。

## Commit Policy

每個 commit 必須是小而完整的單位。commit message 格式：

```text
type(scope): short title

Why: Explain why this change is needed.

How: Explain the implementation approach.

Goal: Explain the intended outcome.

Result: Explain what changed or what passed.
```

每次 commit 都要同步檢查 `PROGRESS.md`。如果 checklist 狀態改變，必須在同一個 commit 更新。

## Progress Tracking

`PROGRESS.md` 固定包含：

- Done：已完成。
- In Progress：正在做。
- Todo：尚未完成。
- Learnings：開發過程中值得後續 AI 知道的決策、限制與踩坑。

進度更新原則：

- 每次完成 checklist 項目時立即勾選。
- 每次開始新工作時把項目移到 In Progress。
- 交接前補上 Learnings，避免只存在 AI context 裡。

## Hooks Workflow

本專案使用版本化 git hooks：

```bash
git config core.hooksPath .githooks
```

hooks 的責任：

- `pre-commit`：確認協作文件存在、`CLAUDE.md` / `GEMINI.md` symlink 正確、`PROGRESS.md` 已被納入 commit，並執行可用的驗證指令。
- `commit-msg`：檢查 commit message 是否包含 title、Why、How、Goal、Result。
- `pre-push`：執行完整驗證。

所有 hook 都必須保持可讀、可版本控制、可由人類手動執行。

## Open Source References

可以參考 open source 專案，但遵守以下界線：

- 參考架構、測試策略、資料模型拆分方式。
- 不直接複製大段程式碼，除非 license 允許且已註明來源。
- 不因為 open source 專案使用某框架就照搬；先確認本專案是否真的有相同複雜度。
- 對排班演算法可參考 constraint solving / backtracking 的成熟做法，但第一版以可測試、可解釋為優先。

## AI Collaboration

每個 AI agent 開工前：

1. 讀 `PLAN.md`、`PROGRESS.md`、`AGENTS.md`。
2. 跑 `git status --short --branch`，確認是否有他人未提交變更。
3. 用 `npm run verify` 或最接近的可用指令取得 baseline。
4. 開始工作前更新 `PROGRESS.md` 的 In Progress。
5. 完成後用小 commit 記錄結果。

不要把「我知道了」留在對話裡當唯一紀錄；重要資訊必須落在文件、測試或 commit message。
