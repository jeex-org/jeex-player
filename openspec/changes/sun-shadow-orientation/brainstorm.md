# Brainstorm

## Problem

The apartment rig's sun is a `DirectionalLight` at a fixed position with a fixed 26 m square shadow frustum, so large plans are clipped and small ones waste the 2048² map. Ceilings are invisible outside the `full` shell state and carry no `castShadow`, and the dollhouse cutaway hides exterior walls, so in every overview the sun falls into the rooms from above instead of only through openings. The shadow map re-renders on every frame although the apartment is static. The scene has no orientation: the sun cannot be tied to the plan's north or to a time of day.

## Related work

1. A parallel change in the same repository moves room finishes to a new form and gives the ceiling its own material and UVs in the shell builder. It also adds scene schema version 2.3. Agreed split: that change owns the ceiling's material, UVs and paint; this change owns layers, shadow flags and visibility, and does not edit the shell builder. Whichever change lands first adds 2.3 and the other rebases onto it; the optional `site` field joins the same version.
2. Later steps of the same lighting work (room probes, probe grid, HDRI sky, composer) will read the sun's world azimuth and elevation from this change; nothing of them is in scope here.

## Doubts

1. Does three r186's shadow pass honour the shadow camera's layers and skip invisible objects?
2. Must a change of the dollhouse state invalidate a cached shadow map?
3. Should exterior walls hidden by the cutaway keep casting?
4. Which hook invalidates the cache on door motion, furniture animation, drag and late asset loads?
5. Is texel snapping needed for a fixed, plan-fitted frustum? Which bias values?
6. Do stills, panoramas and mirrors enable layers that would show shadow-only meshes, or rely on a per-frame shadow map?
7. Does an optional `site` field need a schema version?
8. Preset angles; whether to clamp elevation so a patch always reaches the floor; preset colours.
9. Where orientation lives at run time: a rig API or a player module finding the light by name.
10. A host override of the preset now, or later?

## Approaches considered

1. **Shadow-only layer (author).** Hidden ceilings and cut-away walls leave layer 0 and sit on a shadow-only layer; the sun's shadow camera enables that layer. Evidence (partner, verified in `three/src/renderers/webgl/WebGLShadowMap.js`, `renderObject`): r186 skips `visible === false` and tests `object.layers` against the VIEW camera passed to `shadowMap.render`, not the shadow camera. As written the idea does not work.
2. **Shadow-only layer with an explicit adapter (partner).** As 1, plus a small isolated module that wraps `renderer.shadowMap.render`, enables the shadow-only layer on the incoming view camera for the duration of the call and restores the mask in `finally`. No extra pass, no main-pass draws, picking (layer 0 raycasts) ignores hidden casters for free. Engine-dependent: isolated, reinstalled after a context restore, pinned by browser tests.
3. **Invisible caster material (author).** Duplicate casters with `colorWrite = false`, always visible. Costs draw calls in every main pass, including editing modes.
4. **Visibility toggling around the shadow pass (author).** Fragile against three's internals and the render list.
5. **Closed ceiling casters (partner).** Today's ceilings are downward-facing zero-thickness caps: as a caster they leak at grazing angles and depend on face culling. Build separate closed slabs from the solved room polygons, 100 mm thick above the ceiling height, overlapping wall tops by 2 mm, on the shadow-only layer in every shell state, owned and disposed by their own module. The visible ceiling stays the render surface and is not touched. This also keeps this change out of the shell builder.
6. **Fit math in the standard, lifecycle in the player (partner).** Pure fitting and sun-direction functions live next to the standard (no runtime three); the player owns bounds collection, dirtiness and invalidation hooks; the rig exposes a typed apartment API (`setSun`, `setShadowFrustum`) instead of being searched by name.

## Decision

Approach 2 with 5 and 6.

1. **Layers.** One allocation table of render layers (floor ring 1, shadow-only 2). Hidden ceilings are replaced as casters by closed slabs that live only on the shadow-only layer; dollhouse cut-away subtrees (walls, junction cores, opening frames and leaves) drop layer 0 instead of going invisible and keep the shadow-only layer, with every existing `castShadow = false` preserved (window panes and glass door inserts already do not cast). A pure cutaway change does not invalidate the cache: caster membership and geometry stay identical. Furniture that really disappears does invalidate.
2. **Adapter.** A player module wraps `renderer.shadowMap.render` for the shadow-only layer; it is installed with the renderer and again after a context restore, never calls the shadow pass outside `renderer.render`.
3. **Fit.** A pure function fits an orthographic frustum to the light-space bounds of casters and receivers: shell (with thickness), closed ceiling slabs, furniture, apartment floors and conservative door sweeps; the site ground disk, the sky and helpers are excluded. Light and target are placed around the bounds centre with the direction kept and the light upstream of every bound. Padding starts at 0.25 m across and 0.5 m in depth, near at least 0.1 m. Refit after structural changes; during a drag the bounds only grow. No texel snapping: the fit is world-fixed and does not follow the camera (at 25 m one texel is about 12 mm). Bias starts at a 2 mm depth offset (`-0.002 / (far - near)`) and normal bias at half a world texel clamped to 2–20 mm, calibrated by eye; every tuning value lives in the standard, whose appearance version rises from 1 to 2.
4. **Cache.** Per light: `sun.shadow.autoUpdate = false`, `needsUpdate = true` when dirty; the renderer's global gate stays open, so a capture rig and future lamp shadows do not compete for one flag. Dirty sources: door animation, furniture animation (including its final frame), asset move preview, cancel and revert, scene rebuild and revision, a model upgrade swap, a sun change, a refit and a context restore.
5. **Orientation.** Optional `site: { northDeg?, sun? }` in the scene, camelCase like the rest of the document (`north_deg` from the product description is written as `northDeg`). `northDeg` is the world azimuth of true north, clockwise from +Z toward +X, degrees. For a preset of azimuth `A` from north and elevation `E`, `W = northDeg + A` and the direction toward the sun is `[sin W cos E, sin E, cos W cos E]`. Presets (artistic, northern hemisphere, not astronomical): morning 90°/20°, noon 180°/55°, evening 270°/20°. With no `site` the sun keeps today's exact direction `[4.5, 15.5, -11.5]`; with a `site` a missing north is 0 and a missing preset is noon. The world azimuth and elevation are exposed for the later sky rotation (the environment's azimuth is `atan2(z, x)`, so it is `90° − W`). No elevation clamp: whether a patch reaches the floor depends on room depth and façade, which a clamp cannot promise. No colour change per preset in this step.
6. **Schema.** The field joins version 2.3 (shared with the parallel change), 2.2 stays readable; types, the zod schema, the shape validator and the generated JSON Schema change together, with the agreement check.
7. **Captures.** Stills and the default-state capture configure their rig through the same routine as the live view; cube and still cameras stay on layer 0; mirrors clone camera layers and already suppress automatic shadow updates.

## Rejected

1. Layer test on the shadow camera alone: three r186 tests the view camera's layers, so it silently draws no hidden casters.
2. Invisible caster material: main-pass draw calls in editing modes for nothing visible.
3. Visibility toggling around the shadow pass: depends on render-list internals.
4. The visible ceiling cap as the caster: zero thickness leaks at grazing angles, and the parallel change owns that mesh.
5. A global `shadowMap.autoUpdate = false`: live and capture rigs and future lamps would fight over one flag.
6. Texel snapping now: nothing moves the frustum per frame.
7. Elevation clamp: cannot guarantee floor patches.
8. A host attribute for the preset: scene data is enough for now; the later settings panel can add it.

## Open questions

None for the owner. Existing scenes will look different where the sun used to fall through invisible ceilings: that is the intended correction, shown in before/after shots.

## Process

One round with an independent partner agent, read-only, given the author's problem statement, three approaches and ten doubts. The partner found the decisive engine fact (the shadow pass tests the view camera's layers), proposed the adapter, closed ceiling casters, per-light caching, the typed rig API and the angle conventions; the author verified the engine fact in the installed three.js source before accepting it. No disagreement left for a second round.
