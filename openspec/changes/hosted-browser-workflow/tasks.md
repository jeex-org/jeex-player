# Tasks

## 1. Screenshot-only tests

- [ ] 1.1 Add `scripts/screenshot-only.test.ts`, the guard over `tests/e2e/*.spec.ts` (unclassified, marked without a screenshot, helper not first, stale list entry); commit it red and verify it names the unmarked screenshot tests
- [ ] 1.2 Add `tests/e2e/snapshot-policy.ts`, use it in `playwright.config.ts` (and fix its `ignoreSnapshots` comment), add `screenshotOnly()` to `support.ts` (and its screenshot helper comments), mark the screenshot-only tests; verify the guard passes
- [ ] 1.3 Verify through the heavy queue that `CI=1` reports a marked spec as skipped with its reason, and that without `CI` the same spec still runs and compares

## 2. Keyboard settings-panel specs

- [ ] 2.1 Make specs 1 and 2 of `tests/e2e/settings-panel.spec.ts` wait for the collapsed bar before focusing; commit red with the failing line
- [ ] 2.2 Focus the reveal control, press Enter, assert the bar open and the button focused; verify both specs green locally through the heavy queue

## 3. Phone sheet and shard costs

- [ ] 3.1 Take the sheet's resting rect from its first measurement in `tests/component/settings-panel.test.ts`; verify the file green locally through the heavy queue
- [ ] 3.2 Rewrite `COMPONENT_FILE_COST_S` from run 40102002308 (module comment names the run, the total and the missing file), update the comments of `.github/workflows/browser.yml`, and report the predicted heaviest of 8 shards against the 900 s ceiling without changing the ceiling; verify `bun test scripts/component-shards.test.ts scripts/ci-parity.test.ts` green

## 4. Integration

- [ ] 4.1 Push the branch and dispatch the workflow on it; verify the e2e chrome and keyboard specs and the phone-sheet test pass, and the remaining red is only the failures named in the design
