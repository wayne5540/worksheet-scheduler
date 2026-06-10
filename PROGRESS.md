# Development Progress

Last updated: 2026-06-10

## Done

- [x] Committed `PLAN.md` as the baseline product specification.
- [x] Added shared AI collaboration rules in `AGENTS.md`.
- [x] Added `CLAUDE.md` as a symlink to `AGENTS.md`.
- [x] Added `docs/DEVELOPMENT_WORKFLOW.md` for package, TDD, commit, progress, hook, and handoff rules.
- [x] Added versioned git hooks for commit message, progress, symlink, and verification enforcement.
- [x] Added the initial React + TypeScript + Vite TDD toolchain.
- [x] Scaffolded the first app shell without implementing business scheduling logic.
- [x] Added domain model tests and pure domain utilities for employees, shift types, special days, and four-week cycle calculations.
- [x] Added R01-R15 rule validator tests and pure validation functions for existing monthly schedules.
- [x] Added localStorage and IndexedDB persistence tests with minimal persistence adapters.
- [x] Added Excel export structure tests and a minimal `.xlsx` workbook builder.
- [x] Added scheduling relaxation-loop tests and orchestration implementation.
- [x] Added a minimal deterministic attempt scheduler with prefill preservation, R09 pruning, and final validator checks.
- [x] Added the first monthly scheduling UI workflow with stepper navigation, schedule generation, review table, and export action wiring.
- [x] Wired employee and rule setting UI state to `localStorage` with editable employee rows and rule enable toggles.
- [x] Persisted generated monthly schedules to IndexedDB and reload them by month in the UI.
- [x] Added manual schedule cell editing, violation highlighting, and saved export download flow.
- [x] Expanded the attempt scheduler with a constructive full-month staffing path and coverage for realistic R01-R15 rosters.
- [x] Replaced seeded Step 1-3 monthly setup controls with editable carry-in, special-day, and personal-constraint records.
- [x] Expanded Step 5 schedule review to a full-month table with PLAN summary rows.
- [x] Added employee row ordering and rule priority reordering controls.
- [x] Computed Step 1 carry-in automatically from saved previous-month schedules when available.
- [x] Improved Excel export styling and template-like layout metadata.
- [x] Added rule descriptions, relaxed-rule reporting, and a functional regenerate action in the UI.
- [x] Automated previous-month last-shift carry-forward from saved schedules.
- [x] Added Step 5 special-day, date, and weekday header rows.
- [x] Added preflight generation errors for impossible staffing inputs.

## In Progress

- [ ] Audit remaining PLAN requirements against the current implementation.

## Todo

- [ ] Confirm any remaining export polish against a real supplied workbook file when one is available.

## Learnings

- The repository started with only `PLAN.md`; workflow setup must stay lightweight and avoid premature scheduling-engine abstractions.
- `PLAN.md` recommends React or Vue; this workflow selects React + TypeScript + Vite because it is a stable, common SPA stack with straightforward testing support.
- Git hooks are stored in `.githooks` and require `git config core.hooksPath .githooks` after they are committed.
- `pre-commit` intentionally requires `PROGRESS.md` in every commit to keep progress durable across multiple AI contributors.
- `@vitejs/plugin-react` peer dependencies for React Compiler support are optional in the current package metadata, so the setup uses the official Vite React plugin.
- `PLAN.md` now explicitly includes `國A` because the rules convert holiday store-meeting late shifts from `國13` to `國A`; domain code should treat it as a holiday late/work shift.
- Four-week carry-in is required when `prevFourWeekDate + 1` is before the current month, because the cycle start date determines whether the first R02 audit period crosses month boundaries.
- Pure date calculations use UTC `Date` values internally and expose `YYYY-MM-DD` strings at module boundaries to avoid local timezone drift in schedule rules.
- Special day data allows holiday and four-week markers to overlap with store-meeting or deep-cleaning markers; only store-meeting and deep-cleaning are mutually exclusive.
- Rule validators currently validate completed monthly schedules and report violations; they do not yet generate candidate schedules or perform relaxation/backtracking.
- Persistence uses `localStorage` for employee/rule settings and IndexedDB `monthlySchedules` keyed by `month` for monthly schedules; tests use `fake-indexeddb`.
- Excel export uses `write-excel-file`; npm `xlsx@0.18.5` was checked and avoided because `npm audit` reports high severity advisories without a fix.
- Excel export currently builds the workbook structure and Blob; styling and pixel-perfect matching against the supplied template remain future UI/export polish.
- Scheduling orchestration now owns prefill and rule relaxation; `attemptBacktrackingSchedule` provides the first injected search implementation.
- The attempt scheduler now uses the original lightweight fill path for narrow rule sets and a constructive full-month staffing path for active coverage/cycle rules; final validators still own correctness.
- The first UI workflow still starts with seeded monthly defaults, but generation now passes the full active rule list and relies on relaxation when the demo roster cannot satisfy staffing rules.
- Employee and rule settings in the UI now use `LocalStorageSettingsStore`; generated monthly schedules use `IndexedDbScheduleStore`.
- Generated schedules are saved through `IndexedDbScheduleStore` after successful generation; App reloads a saved month into Step 5 when available.
- Step 5 uses editable shift selects for visible schedule cells, saves manual edits back to IndexedDB, validates with the active rule list, and downloads Excel exports through a temporary object URL.
- Store-meeting days count `A` as R08 late coverage, and deep-clean days are excluded from R08 so R15 owns the 8-person staffing requirement.
- Step 1-3 setup is now month-driven: carry-in rows follow employees, special-day toggles cover every date with 店務/大清 mutual exclusion, and personal constraints are stored per employee for the active month.
- Step 5 now renders the full month plus staffing summary rows; the summary logic mirrors the export counts closely enough for UI review, while export styling remains separate polish.
- Employee and rule ordering use explicit up/down controls that persist through the existing localStorage-backed settings stores.
- Step 1 carry-in automation reads the saved previous-month schedule from IndexedDB and counts only `例`/`休` entries from `prevFourWeekDate + 1` through the previous month end; manual rows remain the fallback when no prior schedule exists.
- Excel export now emits a merged title row, frozen top rows/left columns, explicit column widths, landscape orientation, hidden gridlines, and styled cells; no source `.xlsx` template is currently present in the repository for pixel-level comparison.
- Rule descriptions now live on `RuleDefinition`, and Step 5 surfaces relaxed rules from saved schedules while `重新產生` reruns scheduling and overwrites manual edits.
- Previous-month last shifts are loaded from the saved schedule's final date into matching employee records, including holiday shift types such as `國A`.
- Step 5 review table now mirrors the PLAN header structure with special-day markers, date numbers, and weekday labels above the editable schedule cells.
