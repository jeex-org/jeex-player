# Tasks

## 1. Standard (TDD)

- [ ] 1.1 Temperature range in `LIGHTING_STANDARD`; `colour-temperature.ts` test-first (reference values at 2700/4000/6500 K, unit luminance, clamp, monotonic warm→cold), exported from the lighting entry with its export-surface test; version stays 1; lighting entry budget re-measured by its rule if needed; verify unit tests and `build:lib`.

## 2. Applying the temperature

- [ ] 2.1 `light-temperature.ts` test-first with stubs: applies to tagged bank lamps and the walk ambient floor, luminance kept, «Original» restores exactly, late lamps get the value, invalidates the on-demand gate; verify unit tests.
- [ ] 2.2 Walk: budgeted probe-only re-capture after a 250 ms settle; grids untouched; verify unit/stub tests.
- [ ] 2.3 Sun factor in the walk patch (`walkSunScale` in the walk tuning; 1 in editing and capture); measure the sunlit floor peak and texture before and after; verify the walk-lighting browser ratios still hold and add the «Sunlit floor not clipped» and «Façades keep their sun» checks (heavy queue).

## 3. Host contract

- [ ] 3.1 Options, schema, resolvers, attributes (live), query parameters, handle method and state, event, iframe command and event, bridge and host; each with its unit test and the surface tests (published exports, option sets, protocol lists); verify those tests.
- [ ] 3.2 Local demo enables `settings`; README options/attributes/events tables and CHANGELOG.

## 4. Panel

- [ ] 4.1 `settings-panel.ts` and CSS (no Tailwind, plain CSS over `--jeex-*`), strings in all seven catalogues; unit tests for state and keyboard handling.
- [ ] 4.2 Browser/e2e (heavy queue): button hidden by default with the bar pixel-identical; shown without moving any existing control (positions compared); keyboard, Escape, focus return, outside press; axe clean in the shadow DOM; narrow viewer as a bottom sheet; two viewers on one page independent.

## 5. Acceptance and integration

- [ ] 5.1 Browser checks: default pixel-identical to main in editing and walk (walk with the sun factor excepted on sunlit surfaces); swatches unchanged; warm/cold chromaticity on a lamp-lit grey card; context restore keeps the value; still and panorama capture use it.
- [ ] 5.2 Before/after shots from identical, logged poses (living room with lamps at Original, 2700 K, 6500 K; a sunlit floor in walk before and after the sun factor; the bar with and without the settings button), saved outside the repository.
- [ ] 5.3 Fast tier green, then the full gate once through the machine's gate queue.
