#!/usr/bin/env bash
# The console-policy gate: `check.sh` and `.github/workflows/ci.yml` both call
# this ONE script instead of each carrying its own copy of the grep, so the two
# step lists can't drift apart silently (`scripts/ci-parity.test.ts`).
#
# Nothing in `src/` writes to the console except the two sinks:
# `shared/logger.ts`, which every layer reports through, and `embed/host.ts`,
# whose iframe handle must import no viewer code at all (4 KB gzip budget).
# Everything else raises a `LogEntry` on `ViewerOptions.onLog`.
#
# Usage: `bash scripts/console-policy.sh` from the repository root.
set -euo pipefail

CONSOLE_HITS=$(grep -rn --include='*.ts' -E 'console\.(log|warn|error|info|debug|trace)\(' src \
  | grep -v -E '^src/(shared/logger|embed/host)\.ts:' || true)
if [ -n "$CONSOLE_HITS" ]; then
  echo "console.* outside the logging seam:" >&2
  echo "$CONSOLE_HITS" >&2
  exit 1
fi
echo "0 console.* outside src/shared/logger.ts and src/embed/host.ts"
