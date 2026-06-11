#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'verify-workflow: %s\n' "$*" >&2
  exit 1
}

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root"

[ -f PLAN.md ] || fail "PLAN.md is missing."
[ -f AGENTS.md ] || fail "AGENTS.md is missing."
[ -f PROGRESS.md ] || fail "PROGRESS.md is missing."
[ -f docs/DEVELOPMENT_WORKFLOW.md ] || fail "docs/DEVELOPMENT_WORKFLOW.md is missing."

for collaboration_file in CLAUDE.md GEMINI.md; do
  [ -L "$collaboration_file" ] || fail "$collaboration_file must be a symlink to AGENTS.md."
  collaboration_target="$(readlink "$collaboration_file")"
  [ "$collaboration_target" = "AGENTS.md" ] || fail "$collaboration_file must point to AGENTS.md, got: $collaboration_target"
done

for heading in "## Done" "## In Progress" "## Todo" "## Learnings"; do
  grep -q "^$heading$" PROGRESS.md || fail "PROGRESS.md is missing section: $heading"
done

if [ -f package.json ]; then
  [ -f package-lock.json ] || fail "package-lock.json is required when package.json exists."
  node --input-type=module <<'NODE'
import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const requiredScripts = ['dev', 'build', 'lint', 'test', 'verify']
const missing = requiredScripts.filter((script) => !pkg.scripts?.[script])

if (missing.length > 0) {
  console.error(`verify-workflow: package.json is missing scripts: ${missing.join(', ')}`)
  process.exit(1)
}

if (pkg.packageManager && !pkg.packageManager.startsWith('npm@')) {
  console.error(`verify-workflow: expected npm packageManager, got ${pkg.packageManager}`)
  process.exit(1)
}
NODE
fi

printf 'verify-workflow: ok\n'
