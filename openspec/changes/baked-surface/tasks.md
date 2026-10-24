# Tasks

## 1. Composer (TDD)

- [ ] 1.1 `src/render/shader-compose.ts` test-first in unit tests: owned chunks expanded between markers before any transform; fixed order (walk, baked, others by registration) whatever the registration order; same id and version a no-op, a new version replaces in place; key from the foreign key and ids@versions only; a foreign hook runs first; no renderer argument accepted; a copied hook adopts a copy of the source's list and the two diverge; a missing anchor throws with the id. `baked-surface.ts` re-exports `addShaderTransform` and `ShaderTransform` with the stub's exact signatures; the lightmap binding's expectations (`#include <lightmap_pars_fragment>` left in place) pinned in a test. Verify: `bun test` on the new files and `scripts/check.sh fast`.

## 2. Walk rewrite through the composer

- [ ] 2.1 `installWalkPatch` registers `jeex-walk-lighting@2` through the composer; replacements move to anchors in the expanded chunks with per-line envmap guards; `JEEX_WALK_LIGHTING` and the fragment-scope `jeexSunScale`; grid sample, hand-over and diffuse scale behind `#ifndef JEEX_BAKED_SURFACE`. Update `box-probe-patch.test.ts` (anchors, key) first. Verify: unit tests, then the existing `tests/component/walk-lighting.test.ts` identity and calibration checks unchanged (heavy queue, that file only), and the existing walk scenarios still pass on SwiftShader.

## 3. Baked policy

- [ ] 3.1 `src/render/light-order.ts` test-first with unit tests over scene graphs (traversal order, hidden ancestor, camera layer, stable sort by shadow and map, split by type, fill by name, unflagged = live). Verify: `bun test` on the file.
- [ ] 3.2 `src/render/baked-surface-glsl.ts` with `BAKED_CHUNK_ANCHORS` pinned against the installed r186.1 chunks, and `baked-surface.ts` bodies (`markBakedSurface` idempotent: flag, transform, per-draw mask hook chained onto an existing `onBeforeRender`; `setLampBaked`; `isBakedSurface`) on the stub's `userData` keys. Unit tests for flags, idempotence and the produced shader text. Verify: unit tests and `scripts/check.sh fast`.
- [ ] 3.3 New `tests/component/baked-surface.test.ts` (float readback, `tests/headless-webgl.ts`, grey `MeshPhysicalMaterial` with `specularIntensity` 0), with its SwiftShader cost in `COMPONENT_FILE_COST_S`: zero lightmap under hemisphere, ambient, grid, environment and fill equals an independent sun-only reference on lit and shadowed pixels; nonzero lightmap adds as expected; fill doubled changes nothing on baked, something on unbaked; baked, live and unmarked point and spot lamps; specular highlight kept; baked lamp on an unbaked surface; mixed shadow and cookie ordering, hidden ancestor, camera layer; nested render; program count constant across toggles; unbaked scene identical before and after the change; registration order and copied hooks render the same; context restore. Verify: heavy queue on SwiftShader (the tier default), that file only, with the numbers in the report.

## 4. Mode parity

- [ ] 4.1 Walk: a baked floor's lightmap contribution inside a room in walk equals the editing contribution times the walk sun factor (read before the post chain); a probe capture sees the unscaled lightmap; the grid's irradiance doubled leaves a baked floor unchanged; no program compiled after the swap frame with baked surfaces in view. Added to `tests/component/baked-surface.test.ts` or a walk sibling file with its cost entry. Verify: heavy queue, affected files only.

## 5. Integration

- [ ] 5.1 Sizes: `scripts/check.sh fast` (line limits; `viewer-app.ts` untouched), `bun run build` and `bun run build:lib`, boot budget and the walk chunk measured; a limit crossed by this growth is re-measured under its own rule and recorded. Verify: `budget-check` green with the measured numbers in the report.
- [ ] 5.2 Seam check for the lightmap binding: in `tests/component/baked-surface.test.ts`, a stand-in decode transform anchored as the binding's is (after `#include <lightmap_pars_fragment>`, redefining `lightMapIntensity`) composes with the walk and baked transforms in both registration orders and on a copied hook, with identical pixels and one program. Verify: heavy queue, that file only.
- [ ] 5.3 Full gate once through the machine's gate queue after the review of record.
