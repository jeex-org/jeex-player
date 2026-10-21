#!/usr/bin/env bash
# no-docs-refs.sh: fails when a tracked file names the internal workspace documents folder.
# A repository explains itself in its own files; paths into its own docs/ folder are fine.
# Usage: bash scripts/no-docs-refs.sh [--staged]   (--staged scans the index, for the pre-commit hook)
# Exit: 0 clean, 1 references found, 2 usage error or not inside a git repository, >2 git grep failure.
set -euo pipefail
scope=()
case "${1:-}" in
  "") ;;
  --staged) scope=(--cached) ;;
  *) echo "no-docs-refs: unknown argument '$1' (usage: no-docs-refs.sh [--staged])" >&2; exit 2 ;;
esac
top=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "no-docs-refs: not inside a git repository" >&2; exit 2; }
cd "$top"
pattern='\.\./docs/|docs/superpowers|JEEX_DOCS|docs/PROJECT-MAP|docs/ports\.md'
# git grep exits 1 on no match; anything above 1 is a failure of the scan itself.
rc=0
hits=$(git grep "${scope[@]}" -nE "$pattern" -- . ':!scripts/no-docs-refs.sh') || rc=$?
if [ "$rc" -gt 1 ]; then echo "no-docs-refs: git grep failed (exit $rc)" >&2; exit "$rc"; fi
if [ -n "$hits" ]; then echo "$hits"; echo "no-docs-refs: the lines above name the internal docs folder" >&2; exit 1; fi
echo "no-docs-refs: clean"
