# Design

## Context

See proposal.md for motivation and brainstorm.md for the alternatives. Facts that shape the design:

1. three r186 `WebGLShadowMap.renderObject` skips `visible === false` and tests `object.layers` against the VIEW camera handed to `shadowMap.render`, not against the shadow camera. A caster that must not be seen therefore needs the view camera's layer mask widened for the duration of the shadow pass.
2. `WebGLShadowMap` honours a per-light gate (`light.shadow.autoUpdate`, `needsUpdate`) as well as the global one.
3. The visible ceilings are zero-thickness downward caps built by the shell builder, which another change is rewriting for materials; this change must not edit that builder.
4. `src/lighting/` imports no three.js at runtime and is a published entry; numbers live only in `LIGHTING_STANDARD`.
5. `render-runtime.ts` (626 lines) and `viewer-app.ts` (499) are near the 700-line file limit; new behaviour goes into new modules.

## Goals / Non-Goals

**Goals:** a typed sun API on the apartment rig; pure, tested direction and fit math; shadow-only casters for hidden ceilings and cut-away walls; a cached, invalidated shadow map; orientation in the scene document.

**Non-Goals:** colour of the sun per preset, latitude and astronomical sun positions, a host attribute for the preset, occluding the hemisphere, fill or environment (later steps replace them), cascades or texel snapping.

## Decisions

1. **Render layers in one table.** `src/shared/render-layers.ts` names every custom layer: the floor ring keeps 1, shadow-only takes 2. `floor-ring.ts` imports its number from there.
2. **Shadow-pass adapter.** `src/render/shadow-layer-pass.ts` replaces `renderer.shadowMap.render` with a wrapper that enables the shadow-only layer on the incoming camera, calls the original and restores the mask in `finally`. Installed by the render runtime with its renderer and again after a context restore; idempotent; removable on dispose. Nothing else calls the shadow pass. A browser test pins the r186 behaviour (a caster only on the shadow-only layer darkens a receiver; without the adapter it does not), so an engine upgrade that changes it fails loudly.
3. **Ceiling casters.** `src/geometry/ceiling-casters.ts` builds, per non-loggia room, a closed slab from the solved room polygon: bottom at the ceiling height, 100 mm thick, the outline grown by the 2 mm wall-top overlap; `castShadow = true`, `receiveShadow = false`, layers = shadow-only only, a shared depth-only material it owns. It reads the same solved plan the shell builder reads. One shared preparation, `prepareSunShadow(root, scene, plan, rig)` in `src/render/sun-shadow.ts`, adds the slabs beside the shell, applies the cut-away layer policy, configures orientation and fit, and returns a cleanup; the live scene mount and every offscreen build in `capture-commands.ts` (`inState`) call it, so a default capture has the same casters as the live view. The visible ceiling is left as it is. Exports skip anything on the shadow-only layer alone.
4. **Cutaway by layers.** The dollhouse stops setting `visible = false` on cut-away exterior wall subtrees and hidden ceilings; instead it moves those subtrees (every descendant: layers do not inherit) between layer 0 + shadow-only and shadow-only only. Ceilings, now drawn as casters by the slabs, keep `castShadow = false` on the visible cap so the cap never double-casts. Furniture hidden for real keeps `visible = false` and marks the shadow dirty.
5. **Pure math in the standard.** `src/lighting/sun-direction.ts` (presets → direction, world azimuth and elevation, legacy default) and `src/lighting/shadow-fit.ts` (boxes + direction + effective map size → light position, target, camera up, six planes, bias, normal bias). The light-space basis is three's: the shadow camera looks from the light to the target with up +Y, or −Z when the sun is within 1° of the zenith; the fit returns that up vector and the rig sets it on the shadow camera. The world texel is the larger of width / mapSize and height / mapSize. A test applies a fit to a real three `DirectionalLight` and checks every corner projects inside the clip volume. Tuning lives in `LIGHTING_STANDARD.apartment.sun`: presets, `fit: { lateralPadding: 0.25, depthPadding: 0.5, minNear: 0.1, depthOffset: 0.002, normalBiasTexels: 0.5, normalBiasMin: 0.002, normalBiasMax: 0.02 }`, the legacy direction derived from today's position and target. `LIGHTING_STANDARD_VERSION` stays 1: these are additions of data and functions that change no existing rig value (owner decision on review; consumers key preview caches on it).
6. **Typed apartment rig.** `createApartmentRig` returns `ApartmentRig = LightingRig & { readonly shadowMapSize, setSunDirection(dir), setShadowFrustum(fit), markShadowDirty() }`. Caching is opt-in through a new rig option `shadowCache` (default false), so external consumers keep live shadows; with it the sun's `shadow.autoUpdate` is false and `needsUpdate` true at creation, and every setter and `markShadowDirty` raise `needsUpdate`. The player always passes `shadowCache: true`. Input is judged before anything changes (`bad-options`).
7. **Player controller.** `src/render/sun-shadow.ts` owns the scene's caster and receiver bounds (shell walls, ceiling slabs, furniture, floors, door sweep boxes; the site ground, sky and helpers excluded by tag). Operations: `refit()` after a structural change; `markDirty()` for a pose or visibility change inside the fit; `include(box)` while a drag or an animation runs, which grows the frustum only when the box leaves it; `endPreview()` on commit, cancel or revert, which refits. Furniture animation passes its animated object's current world box each frame it changes. Configured from the scene mount on load, rebuild, revision and model swap, and from context recovery; offscreen captures run the same preparation over their own scene, so orientation and policy match while the bounds are their own.
8. **Dirty sources.** Mapped in tasks.md «Mutation matrix»: each geometry, pose or visibility change of a caster or receiver calls `markDirty`, `include` or `refit`; paint-only changes (`set_material`, finish remaps that keep geometry) and shell-state changes call nothing. No per-frame traversal.
9. **Schema 2.3.** `site?: { northDeg?: number; sun?: 'morning' | 'noon' | 'evening' }` in `SceneData`, a strict zod object in `types.schema.ts`, the shape validator, the JSON Schema generator, the agreement check, the docs of the scene format and the CHANGELOG. If the parallel change has already added 2.3, this change rebases onto it and adds only the field.

## Risks / Trade-offs

1. [The adapter relies on an engine detail] → isolated module, browser test that fails on an upgrade, documented at the module.
2. [A missed dirty source leaves a stale shadow] → every animator and the move wiring are covered by tests that count shadow redraws; the debug surface exposes the redraw count.
3. [Existing scenes change look] → intended; before/after shots in the delivery.
4. [Bias values are a starting point] → calibrated by eye on the demo apartment at all three presets and the legacy direction; numbers end in the standard.
5. [Cut-away walls on layers instead of `visible`] → picking already raycasts layer 0 only; a test proves a click through a cut-away wall reaches the interior.

## Migration Plan

Additive for consumers: rigs keep working without calls to the new setters; 2.2 documents stay valid. Rollback is a revert of the delivery.
