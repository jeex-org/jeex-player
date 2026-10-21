#!/usr/bin/env bash
# Quality gate for jeex-viewer. Every step below is a HARD step, with one
# exception: `code-ranker`, an optional structural lint, is skipped with a
# message when the tool is not installed. The two GitHub workflows together
# run the same step LIST (in a different order, see their headers), minus
# `code-ranker` and plus the Playwright browser install CI needs and a
# developer's machine already has: `.github/workflows/ci.yml` runs every step
# that needs no browser on each push and pull request, and
# `.github/workflows/browser.yml` runs the browser levels only when started by
# hand. This script is therefore the only place the browser levels run before
# a pull request. `scripts/ci-parity.test.ts` proves the LIST itself never
# drifts.
#
# THREE TIERS, one content:
#
#   fast      the TDD loop — every cheap static step plus the bun tests
#             SELECTED BY THE CHANGE (`scripts/select-tests.ts` walks the
#             import graph backwards from every changed file). No coverage, no
#             browser, no production build, no port taken.
#   standard  before a commit — everything `fast` runs, unrestricted: the whole
#             `bun test` run with its per-layer coverage floors, the Vitest
#             browser level with the DOM floors, the demo build and its bundle
#             budget. No Playwright.
#   full      before a pull request — everything `standard` runs plus
#             Playwright e2e, the library build and its per-file budgets,
#             `publint`/`attw`, the site build, `bun audit` and
#             `code-ranker`. It is the DEFAULT: a bare `check.sh` is the full
#             gate.
#
# The tiers are nested BY CONSTRUCTION, not by a second list: every step below
# is either unconditional (all three tiers), inside `if [ "$TIER" != fast ]`
# (standard and full) or inside `if [ "$TIER" = full ]` (full only).
# `scripts/check-tiers.test.ts` parses THIS file and pins the exact membership
# of all three tiers, so the lists can never drift apart silently.
#
# Cheap static steps first: every step that needs neither a runtime, a browser,
# nor a production build runs before any step that does, so a static failure
# (`check:arch`, `check:dead`, a type error) surfaces in seconds rather than
# after minutes of test and browser work (`scripts/check-tiers.test.ts`
# `describe('check.sh step order')` pins this).
#
# Usage: bash scripts/check.sh [fast|standard|full] [repo-or-worktree-dir]
set -euo pipefail
TIER=""
DIR=""
for arg in "$@"; do
  case "$arg" in
    fast | standard | full)
      if [ -n "$TIER" ]; then
        echo "error: two tiers given ($TIER and $arg); name exactly one" >&2
        exit 2
      fi
      TIER="$arg"
      ;;
    *)
      # Two directories are an error, never a silent pick of one of them.
      if [ -n "$DIR" ]; then
        echo "error: two directories given ($DIR and $arg); name exactly one" >&2
        exit 2
      fi
      DIR="$arg"
      ;;
  esac
done
TIER="${TIER:-full}"
# Absolute from here on: the script `cd`s into `$DIR`, so a RELATIVE argument
# would resolve twice against it.
DIR="$(cd "${DIR:-$(pwd)}" && pwd)"
cd "$DIR"

echo "# check.sh: $DIR (tier=$TIER)"

if [ "$TIER" = fast ]; then
  # ONE base and ONE root list for the whole tier. The base policy lives in
  # `scripts/select-tests.ts` (`--print-base`) and is asked for once here, so
  # nothing downstream can measure a different change. The roots are exported
  # for the same reason: `scripts/check-fast.selftest.sh`
  # reads them instead of repeating them.
  export JEEX_FAST_ROOTS="${JEEX_FAST_ROOTS:-src scripts}"
  if ! FAST_BASE="$(bun run scripts/select-tests.ts --print-base)"; then
    echo "error: could not resolve the base of this change; nothing was run" >&2
    exit 1
  fi
  export JEEX_FAST_BASE="$FAST_BASE"
  echo "# fast tier: base $JEEX_FAST_BASE, roots $JEEX_FAST_ROOTS"
fi

echo "== typecheck (src, dev, vite.config.ts)"
bun run typecheck
echo "== typecheck (scripts, vite configs)"
bun run typecheck:scripts
echo "== lint"
bun run lint
echo "== format"
bun run format:check
echo "== source hygiene (spelling, headers)"
# British spelling in identifiers and prose, and a `/**` header on every
# non-test module. The forced API names and the pending list live IN the
# script, each with a reason.
bun run scripts/spelling-check.ts src
echo "== size-check"
bun run scripts/size-check.ts src
echo "== check:arch"
bun run check:arch
echo "== check:dead"
bun run check:dead
echo "== schema: generate-to-tmp + check"
# The gate lives in ONE place, `scripts/schema-gate.sh` — CI calls the same
# script, so the two step lists can't drift apart silently
# (`scripts/ci-parity.test.ts`). Runs in EVERY tier — it is a few hundred
# milliseconds, needs no Playwright and no production build — so a
# schema/type drift is caught on every intermediate commit, not only at the
# final full gate.
bash scripts/schema-gate.sh
echo "== console policy (src/)"
# The grep lives in ONE place, `scripts/console-policy.sh` — CI calls the
# same script, so the two step lists can't drift apart silently
# (`scripts/ci-parity.test.ts`).
bash scripts/console-policy.sh
echo "== listener policy (signal)"
# Every `addEventListener` in `src/` must carry `{ signal }`: an allowlist
# entry inside the script is the only exception, each with its reason. CI runs the same script (`scripts/ci-parity.test.ts`).
bun run scripts/listener-policy.ts src
echo "== no-docs-refs"
# No tracked file may name a documents folder outside this repository: the
# repository explains itself in its own files. The same script runs staged in
# the pre-commit hook (`lefthook.yml`) and in CI (`scripts/ci-parity.test.ts`).
bash scripts/no-docs-refs.sh
echo "== bun test ($DIR, tier=$TIER)"
if [ "$TIER" = fast ]; then
  # Selected by the change: `scripts/select-tests.ts` walks the import graph
  # backwards from every file the working tree changed and names the tests that
  # can see the change. `scripts/fast-bunfig.toml` is the same configuration
  # minus coverage — `bunfig.toml`'s repository-wide `coverageThreshold` is a
  # statement about the WHOLE suite, and applying it to a handful of files
  # would fail a green change for arithmetic, not for a fault.
  # Read into an ARRAY and expand it quoted, so a path with a space in it stays
  # one filter. A failure of the
  # selector is the gate's failure and says so, instead of dying wordlessly
  # under `set -e` inside a command substitution.
  SELECTED_LIST="$(mktemp "${TMPDIR:-/tmp}/jeex-selected-XXXXXX")"
  if ! bun run scripts/select-tests.ts $JEEX_FAST_ROOTS >"$SELECTED_LIST"; then
    rm -f "$SELECTED_LIST"
    echo "error: scripts/select-tests.ts could not name the tests this change reaches; nothing was run" >&2
    exit 1
  fi
  SELECTED=()
  while IFS= read -r selected_line; do
    [ -n "$selected_line" ] && SELECTED+=("$selected_line")
  done <"$SELECTED_LIST"
  rm -f "$SELECTED_LIST"
  if [ ${#SELECTED[@]} -eq 0 ]; then
    echo "   no bun test is reached by this change"
  else
    echo "   ${#SELECTED[@]} selected test file(s)"
    bun test --config=scripts/fast-bunfig.toml "${SELECTED[@]}"
  fi
else
  # `bun run test`, not `bun test`: the script names `src scripts`, and Bun's
  # default glob would otherwise also collect `tests/component/**`, which is the
  # Vitest browser level and cannot run under Bun.
  bun run test
fi

if [ "$TIER" != fast ]; then
echo "== coverage floors"
bun run check:coverage
echo "== component tests (Vitest browser mode)"
# Needs Chromium: `bunx playwright install chromium` once per machine. Binds
# port 3702 (`JEEX_COMPONENT_PORT` overrides it; 3708 is the fallback where 3702
# is unreachable on loopback), which is why `standard` and `full` are
# one-at-a-time on a machine and `fast` is not.
bun run test:component
echo "== DOM-layer coverage floors"
bun run check:coverage:component
echo "== npm run build"
# A production build, and the place `scripts/css-contract-check.ts` proves the
# emitted stylesheet still carries `light-dark()`: not part of `fast`.
npm run build
echo "== npm run check:budget"
npm run check:budget
fi

if [ "$TIER" = full ]; then
echo "== e2e tests (Playwright)"
# Starts its own `vite` on 3701 (`playwright.config.ts` `webServer`); it does
# NOT touch the live server on 3700.
bun run test:e2e
echo "== npm run build:lib"
npm run build:lib
echo "== npm run check:budget:lib"
npm run check:budget:lib
echo "== check:pkg"
# `publint`/`attw` read the built `dist-lib`: needs `npm run build:lib` above,
# so it stays full-only along with the build itself.
bun run check:pkg
echo "== site build"
# The player site (`site/` plus the demo build under `demo/` and the
# published schemas) assembled into `site-out/` from the `dist/` the
# standard tier's `npm run build` wrote. It is what a release deploys.
bun run scripts/site-build.ts
echo "== bun audit"
bun audit
echo "== code-ranker check"
# Optional structural lint (dependency cycles, coupling, complexity; config in
# `code-ranker.toml`). Skipped with one line when the tool is not installed.
if command -v code-ranker >/dev/null 2>&1; then
  code-ranker check . --plugins ts
else
  echo "   code-ranker is not installed; skipped"
fi
fi

echo "== check.sh: OK ($TIER)"
