# Tasks

## 1. Standard (TDD)

- [x] 1.1 Temperature range in `LIGHTING_STANDARD`; `colour-temperature.ts` test-first (reference values at 2700/4000/6500 K, unit luminance, clamp, monotonic warm→cold), exported from the lighting entry with its export-surface test and the entry's consumer fixture; version stays 1; lighting entry budget re-measured by its rule if needed; verify unit tests and `build:lib`.

## 2. Applying the temperature

- [x] 2.1 Tag the bank's point lights (`buildLamp`, `buildPendant`, `buildCeilingLight`: `userData.artificialLight = { colour }`); `light-temperature.ts` test-first using the real bank builders: luminance kept, «Original» restores exactly, applied on new roots and model swaps, on the offscreen scene of default-state captures, and to the walk ambient floor; invalidates the on-demand gate; verify unit tests.
- [x] 2.2 Walk: probe re-capture one room per frame after a 250 ms settle, written in place, each invalidating the gate; grids never re-baked; repeated input coalesces; verify unit/stub tests.
- [x] 2.3 Sun factor in the walk patch (`walkSunScale` in the walk tuning; 1 in editing and capture); a test pins the new loop anchor in the r186 chunk and identity in editing/capture; measure the sunlit floor (64 × 64 px, the preset whose sun reaches a seen floor: noon; all three recorded) before and after; verify the walk-lighting ratios and the new floor, façade and lamp checks (heavy queue).

## 3. Host contract (test-first for schema and resolvers)

- [x] 3.1 Before adding lines, extract wiring as needed so `render-runtime.ts` stays under 700 and `viewer-app.ts` at or under 500.
- [x] 3.2 Options, schema, resolvers (invalid attribute/query keeps the current value with one warning; handle throws `bad-params` with path `lightTemperature`; removal = «Original»), attributes (live), query parameters, handle method and `getState().lightTemperature`, event `lightTemperature` / `jeex-light-temperature` (no event on unchanged), iframe command and event, bridge and host; each with its unit test and the surface tests (published exports, option sets, protocol lists, debug members if any); verify those tests.
- [x] 3.3 Local demo enables `settings`; README options/attributes/events tables and CHANGELOG.

## 4. Panel

- [x] 4.1 `settings-panel.ts` and CSS (plain CSS over `--jeex-*`), strings in all seven catalogues; unit tests for state, «Original» thumb and first adjustment, keyboard handling, mutual exclusion.
- [x] 4.2 Browser/e2e (heavy queue; new files in `COMPONENT_FILE_COST_S`): button hidden by default with the bar pixel-identical; shown without moving any existing control on both sides of the narrow breakpoint (600 px: button under the bar's end; 430 px: panel as a bottom sheet) and in a narrow viewer inside a wide page; open/first adjustment/reset/reopen; keyboard, Escape, focus return, outside press inside and outside the viewer; mutual exclusion with «Interior style»; edits off, «Interior style» unavailable, chrome hidden; live locale change; chrome awake while open; axe clean in the shadow DOM; two viewers independent.

## 5. Acceptance and integration (heavy queue)

- [x] 5.1 Browser checks: «Original» keeps editing-mode frames pixel-identical to main; swatches unchanged; warm/cold chromaticity and luminance within 5 % on a lamp-lit grey card; context restore keeps the value; live and default-state stills and a panorama show the temperature.
- [x] 5.2 Before/after shots from identical, logged poses (living room with lamps at Original, 2700 K, 6500 K; the sunlit floor in walk before and after the sun factor; the bar with and without the settings button, wide and narrow), saved outside the repository.
- [x] 5.3 Fast tier green, then the full gate once through the machine's gate queue.
