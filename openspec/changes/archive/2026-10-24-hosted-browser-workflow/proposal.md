# Proposal

## Why

The on-demand "Browser tests" workflow has never passed on a hosted runner. Part of the red is tests that assume a developer machine: setups that race the control bar's 4.2 s idle timer, a pixel literal that follows font metrics, and a shard cost table that no longer matches the runner. Those failures hide the ones that need product work.

## What Changes

1. A helper in `tests/e2e/support.ts` marks a test as screenshot-only; it skips the test when screenshot comparisons are ignored (`CI` set), with the reason in the skip. `playwright.config.ts` takes `ignoreSnapshots` from the same predicate.
2. A bun test guards the rule: every e2e test that takes a screenshot is either marked screenshot-only or listed with the assertions it still checks on CI.
3. The keyboard settings-panel e2e specs reach a deterministic collapsed bar, wake it through the reveal control by keyboard, and only then focus and press the settings button.
4. The phone settings-sheet component test takes the sheet's resting rect from its first measurement; left, right and bottom stay literals.
5. `COMPONENT_FILE_COST_S` is rewritten from a hosted runner job's per-file times; the workflow's comments carry the measured numbers.

No product code changes.

## Capabilities

### New Capabilities

- `hosted-browser-tests`: how the browser test levels behave on a hosted runner without a GPU: which tests run there, how they wait, and how the component shards are balanced.

### Modified Capabilities

None.

## Impact

`tests/e2e/support.ts`, a new `tests/e2e/snapshot-policy.ts`, `playwright.config.ts`, the screenshot e2e specs, `tests/e2e/settings-panel.spec.ts`, `tests/component/settings-panel.test.ts`, `tests/component-shards.ts`, a new `scripts/screenshot-only.test.ts`, comments in `.github/workflows/browser.yml`. Local gate behaviour is unchanged: with `CI` unset every screenshot test still runs and compares.
