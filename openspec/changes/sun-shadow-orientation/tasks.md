# Tasks

## 1. Standard: sun direction and shadow fit (pure, TDD)

- [x] 1.1 Add presets, fit tuning and the legacy direction to `LIGHTING_STANDARD.apartment.sun`, raise `LIGHTING_STANDARD_VERSION` to 2; verify `lighting-standard.test.ts` pins the values and the version.
- [x] 1.2 Write `src/lighting/sun-direction.ts` test-first: preset scenarios of the spec, north rotation, modulo 360, legacy default, world azimuth/elevation; verify `bun test src/lighting/sun-direction.test.ts`.
- [x] 1.3 Write `src/lighting/shadow-fit.ts` test-first: every corner inside with padding for random upward directions and the zenith, smaller plan and bigger map give finer texels, light upstream, near ≥ minimum, up vector rule, bias rule, every `bad-options` case of the spec, and a fit applied to a real three `DirectionalLight` whose clip-space projection contains every corner; verify its test file.
- [x] 1.4 Export both from the `jeex-viewer/lighting` entry and its type declarations; verify the lighting entry check and the export-surface test.

## 2. Apartment rig API

- [x] 2.1 Add the `shadowCache` rig option to `lighting-options.schema.ts`; return a typed `ApartmentRig` with `shadowMapSize`, `setSunDirection`, `setShadowFrustum`, `markShadowDirty`; caching only with the option; judge input before change; verify `lighting-context.test.ts` covers each scenario of the modified «Apartment rig» and «Rig options» requirements, including an uncached consumer whose moved caster shows in the next render.
- [x] 2.2 Update the delta's published-description test (presets and tuning visible and frozen); verify `bun test src/lighting`.

## 3. Scene orientation field (schema 2.3)

- [x] 3.1 Add `site` to `SceneData`, the zod schema, the shape validator and the compile-time agreement check; join or add version 2.3 (keep 2.2 readable); reject `site` in a 2.2 document in both the runtime validator and the generated JSON Schema (version-conditional); verify the validator tests for every scenario of `scene-site-orientation`, with field paths in the messages.
- [x] 3.2 Regenerate the published JSON Schema and extend its test with the valid and invalid examples; verify `scripts/schema-gen.test.ts` and the schema gate.
- [ ] 3.3 Document `site` in the README's scene format section and the CHANGELOG; verify the docs tests and spelling check pass.

## 4. Shadow-only casters

- [ ] 4.1 Create `src/shared/render-layers.ts`; move the floor ring's number there; verify the floor ring tests.
- [ ] 4.2 Write `src/render/shadow-layer-pass.ts` and a browser component test proving a shadow-only caster darkens a receiver with the adapter and not without it; verify that test file through the heavy queue.
- [ ] 4.2a Make the adapter restore the camera mask when the shadow pass throws and be reinstalled exactly once after a context restore; verify unit tests with a stub renderer.
- [ ] 4.3 Write `src/geometry/ceiling-casters.ts` (closed slabs per non-loggia room, owned material, dispose) test-first; verify its unit test (closed volume, outline overlap, layers, flags).
- [ ] 4.4 Change the dollhouse to move cut-away walls and hidden ceilings by layers, keep visible caps from casting; verify dollhouse tests and a picking test through a cut-away wall.

## 5. Fitted, cached sun shadow in the player

- [ ] 5.1 Write `src/render/sun-shadow.ts` (`prepareSunShadow` returning cleanup; bounds by tag; `refit`, `markDirty`, `include`, `endPreview`) test-first with stub objects; verify its unit test (ground excluded, door sweeps included, include grows only past the fit, endPreview refits).
- [ ] 5.2 Wire it: render runtime installs the adapter and creates the rig with `shadowCache: true`; scene mount calls `prepareSunShadow` on load, rebuild, revision and model swap; context recovery reinstalls; every offscreen build in `capture-commands.ts` calls `prepareSunShadow` and its cleanup; exports skip shadow-only meshes; verify the affected unit tests, a default-state still from an overview whose ceilings block the sun, through the heavy queue, a cache-isolation test (dirty both the live and a capture rig, render the capture first and check the live rig still redraws, then the reverse), and that `render-runtime.ts` and `viewer-app.ts` stay under their line limits.
- [ ] 5.3 Wire every row of the mutation matrix below; expose the sun shadow redraw count on the debug surface (two-file change with its test); verify a browser test per row, through the heavy queue.
- [ ] 5.4 Browser test for «Casters that are not seen»: overview patches only under openings, no caster in still, panorama or mirror, none in GLB/USDZ export, picking through a cut-away wall, glass passes light; verify through the heavy queue.

### Mutation matrix (task 5.3)

| Change | Call | Verified by |
| --- | --- | --- |
| Scene load, rebuild, edit op (walls, openings, rooms, assets), interior preset swap | `refit` | browser: frustum and redraw count after one op of each kind |
| Model upgrade swap | `refit` | browser: frustum contains the upgraded body |
| Door animation frame and final frame | `markDirty` (door sweep reserved in bounds) | browser: redraws per frame, stops after the final pose |
| Furniture animation frame and final frame | `include(box)` | browser: redraws per frame, final pose drawn once |
| Asset move preview / commit / cancel / revert | `include(box)` / `endPreview` | browser: drag outside the fit, then each ending |
| Furniture hidden or shown | `markDirty` | browser: redraw count +1 |
| Sun change, context restore | rig setter / `prepareSunShadow` | unit + browser |
| Paint only (`set_material`, finish remap), shell state, camera motion | nothing | browser: redraw count unchanged |

## 6. Calibration and shots

- [ ] 6.1 Calibrate bias and normal bias by eye on the demo apartment at legacy, morning, noon and evening; record the final numbers in the standard and its test.
- [ ] 6.2 Before/after shots (main vs branch) of the demo apartment: plan3d overview, orbit, walk in the living room, at the legacy direction and the three presets; attach to the delivery notes.

## 7. Integration

- [ ] 7.1 Fast tier green, then the full gate once through the machine's gate queue on the final tree; on red re-run only the failed files.

## Workflow follow-up

- OCR review on the finished diff, one answer commit, then the full gate (7.1), merge on its stamp.
- Archive the change, move brainstorm and review out of the repository, set the archived change to the stock schema, `openspec validate --all --strict`.
