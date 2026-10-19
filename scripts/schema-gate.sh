#!/usr/bin/env bash
# The "schema: generate-to-tmp + check" gate: `check.sh` and
# `.github/workflows/ci.yml` both call this ONE script instead of
# each carrying its own copy, so the two step lists can't drift apart silently
# (`scripts/ci-parity.test.ts`).
#
# Generation-only: neither `ts-json-schema-generator` nor Ajv reaches the
# shipped bundle (`check:budget:lib` proves it). Runs in both `check.sh`
# tiers — it is a few hundred milliseconds, needs no Playwright and no
# production build — so a schema/type drift is caught on every intermediate
# commit, not only at the final full gate.
#
# Usage: `bash scripts/schema-gate.sh` from the repository root.
set -euo pipefail

JEEX_SCHEMA_TMP="$(mktemp -d)"
trap 'rm -rf "$JEEX_SCHEMA_TMP"' EXIT
bun run scripts/schema-gen.ts --out "$JEEX_SCHEMA_TMP"
test -s "$JEEX_SCHEMA_TMP/scene.schema.json"
test -s "$JEEX_SCHEMA_TMP/viewer-options.schema.json"
bun test scripts/schema-check.test.ts
