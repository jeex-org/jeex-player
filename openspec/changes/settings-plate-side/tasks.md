# Tasks

## 1. Host contract (test-first)

- [x] 1.1 Option table row `settings.side` (enum `start`/`end`, default `end`, query `settingsSide`, attribute `settings-side`), the `ViewerOptions` type and defaults, the Zod schema; tests in the option-table harness for both values, the default and an invalid value (default kept, one warning), schema agreement, and the element test for the frozen attribute (change after mount warns, nothing moves); verify with `bun test` on those files.
- [x] 1.2 Pass the resolved side from `viewer-ui.ts` into `SettingsPanel`; README option and attribute tables and the settings section (start-side geometry, the host's choice of side against its own content), CHANGELOG; verify `scripts/no-docs-refs.sh` and the README table test, if any, pass.

## 2. Placement (test-first in the component suite)

- [x] 2.1 First fix `barLayout()` in `tests/component/settings-panel.test.ts`: identify the mode buttons by `data-mode` (and skip the settings button) instead of positional `button-${i}` keys, so a prepended plate does not shift the comparison. Then component tests parameterised over viewer widths 1280, 560, 400 and 360 × both sides: no existing control moves, the plate attached to the chosen edge (beside or under), inside the viewer, long scene name falls back under, above 430 px the open panel aligned to the chosen edge where it fits or clamped inside the viewer after a resize, at 430 px and below the sheet geometry asserted separately and the same for both sides, a resize across 430 px in both directions with the panel open, side alone (without `settings`) creating no button, both sides under a computed `direction: rtl` (plate on the mirrored edge, plate and panel inside the viewer), keyboard order (Tab and Shift+Tab around the start-side button, Escape returns focus); clicks by `element.click()` or dispatched events only; see them red on the start side.
- [x] 2.2 `settings-panel.ts`: side stamp, `prepend` for start, direction-aware `place()` and `anchor()`; `viewer.css`: start-side rules in the component layer, end rules unchanged; verify the component file green through the heavy queue on SwiftShader.

## 3. End to end

- [x] 3.1 `tests/e2e/settings-panel.spec.ts`: start side through `?settingsSide=start` on the demo page and through `settings-side="start"` on an element in a shadow root (with `settings` enabled in both), each with an axe check; interactions by an evaluated DOM click (`element.click()` inside `evaluate`) or keyboard activation, never a Playwright pointer click on a mounted viewer (it stalls on SwiftShader; the existing shadow-root case's `button.click()` is replaced too), with the visibility and in-viewer geometry assertions kept so a dispatched click cannot hide an unreachable button; then the existing chrome baseline specs unchanged, without re-shooting, on `JEEX_BROWSER_GPU=nvidia`; both through the heavy queue, affected specs only.
- [x] 3.2 Measure for the report: with `side: 'start'` at viewer widths 1280, 560 and 400 on the demo page, the bar, plate and button rectangles (x, y, width × height).

## 4. Integration

- [x] 4.1 `scripts/check.sh fast` green; self-review of the diff (no Tailwind, English only, no references to workspace documents, no commit hashes).
- [ ] 4.2 The full gate once through the machine's gate queue; on red, only the failed files are re-run.

## Workflow follow-up

- Review of record over the finished diff before the full gate.
- Archive the change and verify `openspec validate --all --strict`.
