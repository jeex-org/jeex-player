# Tasks

## 1. Layer and fixture

- [x] 1.1 Add the `lightmap` layer right above `render` in the architecture policy and verify `bun run check:arch` passes with an empty `src/lightmap/` module
- [x] 1.2 Copy the calibration bake into `tests/fixtures/lightmap-calibration/` (neutral generator and device strings, recomputed `shellHash`, `lamps` with the corner lamp) and write `calibration-facts.ts` with the scene facts and golden texels of levels 0..3; verify the digest of each fixture file is recorded

## 2. Sidecar

- [x] 2.1 Write `light-bake.schema.test.ts` (fixture accepted; unknown contract, format, keys, ids, duplicates, broken references, missing lamps refused) and see it fail, then write `light-bake.schema.ts`, the `LightBake` type and the agreement check; add the schema to `SCHEMA_MODULES`; verify the test passes
- [x] 2.2 Write `rgbm.test.ts` and see it fail without `rgbm.ts`, then write `rgbm.ts` (reference decode); verify it passes

## 3. Seam

- [x] 3.1 Write `src/render/baked-surface.test.ts` and see it fail without the module, then write `baked-surface.ts` (flags, and `addShaderTransform` as a chaining stub: two transforms apply in order and the key names both `id@version`); verify it passes

## 4. Decode and page

- [x] 4.1 Component test: a 1 × 1 RGBM lightmap with bytes (128, 64, 255, 96) on a zero-specular white material renders the decoded value within 0.5 % and not the sRGB-decoded one; a material with a previous hook and key keeps both; the decode holds with the walk lighting's `patchFragmentShader` composed before and after it; the walk installer run after binding is a pending test naming the lighting delivery. See it fail, then write `lightmap-shader.ts`; verify it passes
- [x] 4.2 Component test: the calibration page loads four levels of the right sizes, and a `texelFetch` read-back of each level equals the golden bytes and digests; a synthetic asymmetric 4 × 2 atlas reads back unflipped and untransposed. See it fail, then write `lightmap-page.ts`; verify it passes

## 5. Binding and loading

- [x] 5.1 Unit and component tests for `bindLightBake`: one clone per (material, page), marks set, AO map dropped, transmissive meshes left unbound and named, lamp flags set and unresolved lamps reported, refusal of missing or ambiguous meshes, bad UV1, multi-material and non-standard meshes, and a hook that removes the decode's anchor or throws when run on the prepared clone, all with nothing changed, `unbind` restoring materials and flags and idempotent, transforms re-centred render the same. See them fail, then write `lightmap-binding.ts`; verify they pass
- [x] 5.2 Test `loadLightBake`: the fixture loads; a wrong shell hash and a refused sidecar fail before any texture exists; a failing level releases the levels already decoded; `dispose` releases every texture and image once. See it fail, then write `light-bake-load.ts`; verify it passes

## 6. Calibration

- [x] 6.1 Component test `lightmap-calibration.test.ts`: the plate's irradiance within 3 % of π; the lamp landmark within 0.15 m; the four-render sun split within 2 % and the analytic sun term within 3 %; the standard material against a CPU-decoded float lightmap (mean relative error under 0.5 %, 95th percentile under 2.5 %); re-centred transforms render the same; printed diagnostics, not gating: the footprint against its ring with the sun off and chart-edge contamination at levels 0..3. Record the measured numbers in the report
- [x] 6.2 Write the full-rig scenario as a pending test naming the lighting delivery it waits for, and say so in the report; verify it is reported as pending, not passing
- [x] 6.3 Add every new component test file's measured cost to `COMPONENT_FILE_COST_S`, the layer to the component coverage include and a floor to the coverage check; verify `bun run check fast` passes

## 7. Dev page

- [x] 7.1 Write `dev/lightmap-calibration.html` and `.ts` (lit scene, raw and decoded atlas, lightmap and sun toggles, measured numbers); open it in a headless browser, take screenshots of each view and look at them

## 8. Integration

- [x] 8.1 Run the standard tier through the heavy queue; verify it is green
- [x] 8.2 Run the end-to-end screenshot specs through the heavy queue; verify every existing baseline matches (the full gate is run once by the integrator before the merge)
