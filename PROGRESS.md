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

## In Progress

- [ ] Add rule validator tests before implementing R01-R15.

## Todo

- [ ] Add IndexedDB/localStorage persistence tests before persistence implementation.
- [ ] Add Excel export structure tests before export implementation.
- [ ] Build the monthly scheduling UI workflow from `PLAN.md`.

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
