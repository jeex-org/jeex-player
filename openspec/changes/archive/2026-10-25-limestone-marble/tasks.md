# Tasks

Each behaviour lands as a pair of commits: a red test commit whose body quotes the failing line, then the code.

## 1. Pin the new look

- [x] 1.1 Red test in `scripts/finish-maps.test.ts`: Cream limestone is bound to version `01a17052-6c88-7224-9c80-240c126fe952`, tinted `#dcc8a4`, with a tile of 1.5 by 1.5 m and roughness 0.593 (to three places); the porcelain repeats stay 3.6 by 1.8 m.

## 2. Re-fetch

- [x] 2.1 Re-fetch with `--update` against the local store (key only in that command's environment); the script must print a change for the limestone entry and for no other finish.
- [x] 2.2 Catalogue `base` of Cream limestone = the new first-frame colour (existing test).
- [x] 2.3 `FINISH_MAPS_BUDGET_BYTES` re-measured only if the folder outgrows it.
- [x] 2.4 Demo and README text changed only where they name the old scan.

## 3. Integration

- [x] 3.1 Fast tier while working; failed files re-run alone through the heavy-run queue.
- [x] 3.2 Archive, then code review and security review over the branch diff, one answer commit.
- [x] 3.3 Rebase on the main branch, then one full gate through the gate queue.
