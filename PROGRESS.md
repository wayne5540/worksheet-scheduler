# Development Progress

Last updated: 2026-06-10

## Done

- [x] Committed `PLAN.md` as the baseline product specification.
- [x] Added shared AI collaboration rules in `AGENTS.md`.
- [x] Added `CLAUDE.md` as a symlink to `AGENTS.md`.
- [x] Added `docs/DEVELOPMENT_WORKFLOW.md` for package, TDD, commit, progress, hook, and handoff rules.

## In Progress

- [ ] Add versioned git hooks for commit message, progress, symlink, and verification enforcement.
- [ ] Add the initial React + TypeScript + Vite TDD toolchain.

## Todo

- [ ] Scaffold the first app shell without implementing business scheduling logic.
- [ ] Add domain model tests for employees, shift types, special days, and four-week cycle calculations.
- [ ] Add rule validator tests before implementing R01-R15.
- [ ] Add IndexedDB/localStorage persistence tests before persistence implementation.
- [ ] Add Excel export structure tests before export implementation.
- [ ] Build the monthly scheduling UI workflow from `PLAN.md`.

## Learnings

- The repository started with only `PLAN.md`; workflow setup must stay lightweight and avoid premature scheduling-engine abstractions.
- `PLAN.md` recommends React or Vue; this workflow selects React + TypeScript + Vite because it is a stable, common SPA stack with straightforward testing support.
