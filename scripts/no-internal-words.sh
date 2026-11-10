#!/usr/bin/env bash
# no-internal-words.sh: fails when a tracked text file carries words of a private
# working process (who reviewed or ran what, on which machine or network) rather
# than of this repository. A contributor needs the change, its reasons and its
# checks; the people, queues and networks a maintainer happened to use are not
# part of the project.
# Usage: bash scripts/no-internal-words.sh [--staged]   (--staged scans the index, for the pre-commit hook)
# Exit: 0 clean, 1 words found, 2 usage error or not inside a git repository, >2 git grep failure.
set -euo pipefail
scope=()
case "${1:-}" in
  "") ;;
  --staged) scope=(--cached) ;;
  *) echo "no-internal-words: unknown argument '$1' (usage: no-internal-words.sh [--staged])" >&2; exit 2 ;;
esac
top=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "no-internal-words: not inside a git repository" >&2; exit 2; }
cd "$top"
pattern='(by|to|for) the orchestrator|ocr review|tailnet|gate queue|heavy-run queue|review of record|the owner asked'
# -I skips binary files (textures, screenshots); git grep exits 1 on no match,
# anything above 1 is a failure of the scan itself.
rc=0
hits=$(git grep "${scope[@]}" -nIiE "$pattern" -- . ':!scripts/no-internal-words.sh') || rc=$?
if [ "$rc" -gt 1 ]; then echo "no-internal-words: git grep failed (exit $rc)" >&2; exit "$rc"; fi
if [ -n "$hits" ]; then echo "$hits"; echo "no-internal-words: the lines above describe a private working process, not the repository" >&2; exit 1; fi
echo "no-internal-words: clean"
