#!/usr/bin/env bash
# Self-test of the `fast` tier: it has to be GREEN and it has to be QUICK on a
# clean tree, because a tier that is slow or noisy in the TDD loop is a tier
# nobody runs.
#
# It is deliberately NOT a `bun:test` file: it starts the gate, and a gate step
# that starts the gate is a loop. Run it after touching `check.sh` or
# `scripts/select-tests.ts` — and AFTER committing
# that edit, because what it measures is the tier's floor on a clean tree:
#
#   bash scripts/check-fast.selftest.sh          # budget: 90 s
#   JEEX_FAST_BUDGET_S=120 bash scripts/check-fast.selftest.sh
set -euo pipefail
cd "$(dirname "$0")/.."

BUDGET="${JEEX_FAST_BUDGET_S:-90}"
if ! [[ "$BUDGET" =~ ^[0-9]+$ ]] || ((BUDGET == 0)); then
  echo "error: JEEX_FAST_BUDGET_S must be a positive whole number of seconds, got '$BUDGET'" >&2
  exit 2
fi

# The roots come out of `check.sh` itself, so the two can never measure
# different trees.
DEFAULT_ROOTS="$(sed -n 's/.*JEEX_FAST_ROOTS:-\([^}]*\)}.*/\1/p' scripts/check.sh | head -1)"
if [[ -z "$DEFAULT_ROOTS" ]]; then
  echo "error: could not read the fast tier's roots out of scripts/check.sh" >&2
  exit 2
fi
ROOTS="${JEEX_FAST_ROOTS:-$DEFAULT_ROOTS}"

LOG="$(mktemp "${TMPDIR:-/tmp}/jeex-viewer-fast-selftest-XXXXXX")"
KEEP_LOG=0
cleanup() {
  if ((KEEP_LOG == 0)); then rm -f "$LOG"; fi
}
trap cleanup EXIT

echo "== the working tree is clean"
# What this file measures is the FLOOR: `fast` with nothing to select. With
# uncommitted work the selector is right to name files, so asserting emptiness
# there would diagnose a correct selector as a broken one — which is exactly
# what a naive version would do in the very workflow its own header describes.
DIRTY="$(git status --porcelain --untracked-files=all)"
if [[ -n "$DIRTY" ]]; then
  echo "error: the fast tier's floor is measured on a CLEAN tree; these files are uncommitted or untracked:" >&2
  echo "$DIRTY" | head -20 >&2
  echo "commit or stash them, then run this again" >&2
  exit 1
fi

# `JEEX_FAST_BASE=HEAD` on purpose: «clean» above means «nothing uncommitted»,
# and this pins the measurement to that, rather than to everything a feature
# branch has committed so far.
export JEEX_FAST_BASE=HEAD
FAILED=0

echo "== a clean working tree selects no test (roots: $ROOTS)"
SELECTED="$(bun run scripts/select-tests.ts $ROOTS)"
if [[ -n "$SELECTED" ]]; then
  echo "error: select-tests.ts named files although nothing is uncommitted:" >&2
  echo "$SELECTED" >&2
  FAILED=1
fi

echo "== check.sh fast is green and inside its ${BUDGET}s budget"
START=$SECONDS
STATUS=0
bash scripts/check.sh fast >"$LOG" 2>&1 || STATUS=$?
ELAPSED=$((SECONDS - START))

if ((STATUS != 0)); then
  echo "error: check.sh fast exited $STATUS (log: $LOG)" >&2
  tail -30 "$LOG" >&2
  FAILED=1
fi
if ((ELAPSED > BUDGET)); then
  echo "error: check.sh fast took ${ELAPSED}s, over its ${BUDGET}s budget (log: $LOG)" >&2
  FAILED=1
fi
if ! grep -q '^== check.sh: OK (fast)$' "$LOG"; then
  echo "error: check.sh fast did not report the tier it ran (log: $LOG)" >&2
  FAILED=1
fi
# The fast tier takes no port and starts no browser: that is what lets several
# worktrees run it at once while one `standard` holds 3702.
if grep -qE '^== (component tests|e2e tests|npm run build)' "$LOG"; then
  echo "error: check.sh fast ran a browser or a production build (log: $LOG)" >&2
  FAILED=1
fi
if ((FAILED == 0)); then
  echo "== check-fast.selftest.sh: OK (${ELAPSED}s of ${BUDGET}s)"
else
  KEEP_LOG=1
  echo "== check-fast.selftest.sh: FAILED (${ELAPSED}s; log kept at $LOG)" >&2
  exit 1
fi
