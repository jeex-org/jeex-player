# Design

## Context

See proposal.md and brainstorm.md. Today `installWalkPatch` (`src/render/walk-lighting/box-probe-patch.ts`, 376 lines, in the lazy walk chunk) overwrites `onBeforeCompile` and `customProgramCacheKey` of every standard and physical material it meets in walk, with one constant key `jeex-walk-lighting-1`, and replaces the `lights_fragment_begin` and `lights_fragment_maps` includes with rewritten copies. It is installed only on walk frames; once installed it stays, and the editing state sets its uniforms to the identity. The lightmap binding (sibling change) ships a stub `src/render/baked-surface.ts` with the agreed signatures, `userData` flags `jeexBakedSurface` (material) and `jeexBaked` (light), `ShaderTransform = (shader: WebGLProgramParametersWithUniforms) => void`, and a chaining `addShaderTransform`; its RGBM decode anchors on `#include <lightmap_pars_fragment>` or the expanded `uniform float lightMapIntensity;`, its preflight calls a material's hook with no renderer, and its bound clones copy the source's two hooks by assignment. three is 0.186.1: the apartment rig's lights are `jeex-lighting-sky` (hemisphere), `jeex-lighting-sun` (directional, casts shadows), `jeex-lighting-fill` (directional); the walk rig adds `jeex-walk-ambient`. `viewer-app.ts` is at its 500-line limit; ordinary modules have a 700-line limit with a 400-line warning.

## Goals / Non-Goals

**Goals:**
1. The baked policy in every mode and every render (display, stills, panoramas, grid and probe captures), for every scene a baked material is drawn in, with no scene-level installation.
2. One composer that the walk lighting, the baked policy, the RGBM decode and later rewrites share.
3. The sibling's signatures and flags unchanged, so its code and tests run unmodified once both land.

**Non-Goals:**
1. Temperature tint on baked surfaces, transmissive shells, AO-map double occlusion, bake invalidation (brainstorm, Decision 8).
2. Any change to the grid selection, the probe capture schedule, the walk calibration numbers or the post chain.
3. A public API: these modules are internal to the player.

## Decisions

1. **Modules.**
   1. `src/render/shader-compose.ts`: the composer (`addShaderTransform`, `ShaderTransform`, the owned-chunk expansion, the order, the key). Boot bundle: the baked policy needs it in the editing modes.
   2. `src/render/baked-surface.ts`: the four agreed exports (re-exporting the composer's two), flag reads and writes on the sibling's `userData` keys, and the per-draw mask hook. `markBakedSurface` sets the flag, registers the baked transform and installs the mask hook; it is idempotent.
   3. `src/render/baked-surface-glsl.ts`: the baked transform's text and its anchors (`BAKED_CHUNK_ANCHORS`, pinned by a unit test against the installed chunks, as `ENGINE_CHUNK_ANCHORS` is for the walk).
   4. `src/render/light-order.ts`: the adapter that reproduces three r186.1's `WebGLLights` order for a scene and camera and returns the point, spot and directional masks. Pure over the scene graph; no renderer internals read.
   5. `box-probe-patch.ts`: `installWalkPatch` registers the walk rewrite through the composer under id `jeex-walk-lighting`, version 2 (the text changes); it keeps its `PATCHED` guard only as a fast path, the composer's id check being the real idempotence.
   Alternative: one module for all of it; rejected, it would cross 400 lines and mix the pinned three adapter with policy.

2. **Composer.**
   1. Per material, an ordered list of `{ id, version, transform }`, held in a `WeakMap` keyed by the material. The installed `onBeforeCompile` and `customProgramCacheKey` are composer functions that look up `this`.
   2. Copied hooks: a material whose hook is a composer function but which has no list of its own (the sibling's clone assigns the source's hooks) adopts a copy of the list of the material the function was installed for, on first use (compile, key or a new registration). The source and the clone then diverge independently.
   3. A foreign hook found on the material when the composer first installs is kept as the first step of the compile and its key (the default key's source text, as the stub does, or the custom key's result) as the first part of the key.
   4. Compile: run the foreign hook; expand the owned chunks `lights_fragment_begin`, `lights_fragment_maps` and `lights_physical_pars_fragment` in the fragment shader in place, each between marker comments `// jeex:<chunk> begin` / `// jeex:<chunk> end` so transforms can anchor at chunk boundaries; then apply the transforms in order. `lightmap_pars_fragment` is not owned and stays an include, so both of the RGBM decode's anchors hold. Later transforms always see the owned chunks already expanded. The renderer argument is optional (the sibling's preflight passes none).
   5. Order: `jeex-walk-lighting`, then `jeex-baked-surface`, then every other id in registration order. Adding an id already present replaces its entry in place (a new version recompiles); same id and version is a no-op.
   6. Key: `jeex|` + the foreign key + `|id@version` for each entry in apply order. No uniform, mask or mode value enters it.
   7. A transform whose anchor is missing throws with the transform's id and the missing anchor at compile time, as the walk patch's anchors do today; the anchor tests pin them to r186.1 so this is never hit on the installed three.
   Alternative: plain chaining (the stub); rejected, two rewrites of one include cannot both apply and later transforms could not rely on expanded text.

3. **Walk rewrite on expanded text.** Its replacements move from include tokens to anchors inside the expanded chunks (the same r186 lines it pins today). The envmap guard that wrapped the whole maps chunk becomes guards around each replaced line. New, for baked awareness, all behind `#ifndef JEEX_BAKED_SURFACE`: the grid sample (`jeexGridIrradiance` stays zero), the grid-to-environment hand-over, and the `jeexDiffuseScale` on `iblIrradiance` (bypassed: 1). It defines `JEEX_WALK_LIGHTING` and declares the interior sun factor `jeexSunScale` at fragment scope before the begin chunk (computed after `jeexLocate`), so the baked transform can reuse it. Invariant kept: with the editing uniforms the output equals the unpatched shader's on an unbaked material.

4. **Baked transform** (id `jeex-baked-surface`, version 1), applied after the walk rewrite:
   1. `#define JEEX_BAKED_SURFACE` at the top of the fragment shader.
   2. Mask declarations: `uniform float jeexPointDiffuse[ NUM_POINT_LIGHTS ]` under `#if NUM_POINT_LIGHTS > 0`, the same for spot (`jeexSpotDiffuse`) and directional (`jeexDirDirect`).
   3. Point and spot loops: the `RE_Direct( … )` call of each loop is replaced with a braced block that keeps `reflectedLight.directDiffuse` before the call and mixes it back by the light's mask after it; the anchors are the two loop bodies' `RE_Direct` lines located by their preceding `getPointLightInfo` and the spot shadow line, so shadow and cookie factors are already applied. Specular is untouched.
   4. Directional loop: `directLight.color *= jeexDirDirect[ i ];` after `getDirectionalLightInfo`, which drops the fill's diffuse and specular and leaves the sun at 1.
   5. After the begin chunk's end marker: `irradiance = vec3( 0.0 );`.
   6. In the physical indirect specular: `reflectedLight.indirectDiffuse += indirectDiffuse;` guarded by `#ifndef JEEX_BAKED_SURFACE` (the line is unique in the chunk; the diffuse RE's line reads `+= diffuse`).
   7. After the maps chunk's end marker: `irradiance *= jeexBakedScale;` where `jeexBakedScale` is `jeexSunScale` when `JEEX_WALK_LIGHTING` is defined and 1 otherwise. Placing it after the maps chunk keeps it independent of how the decode rewrites the lightmap lines; at that point `irradiance` holds only the lightmap.
   Alternative: a separate scale uniform driven by the walk rig; rejected, the sun factor already carries the per-fragment room test and the mode values, and decision 7 asks for the same factor.

5. **Masks per render.** One shared uniforms object for all baked materials (`jeexPointDiffuse`, `jeexSpotDiffuse`, `jeexDirDirect`), merged into each baked shader's uniforms at compile. `markBakedSurface` chains a `material.onBeforeRender` hook that, before each draw, recomputes the masks when the (render call, scene, camera) triple differs from the cached one; the render call is identified by `renderer.info.render.frame`, which three increments per `render`. A nested render changes the triple, and on return to the outer render the camera differs again, so the outer masks are recomputed: nesting is restored without a stack. The adapter (`light-order.ts`) walks the scene as three's `projectObject` does (stop at an invisible object; a light counts when `layers.test(camera.layers)`), sorts stably by `(castShadow ? 2 : 0) + (map ? 1 : 0)` descending, splits by type, and returns for points and spots `userData.jeexBaked === true ? 0 : 1`, for directional lights 0 for the light named `jeex-lighting-fill` and 1 otherwise. Array lengths equal three's counts for that render. Toggling a lamp changes only these values.
   Alternative: a scene `onBeforeRender` hook installed by the runtime; rejected, offscreen capture scenes and host scenes would each need an install.

6. **Context restore**: hooks live on the materials and the uniforms in module state, so three's recompile after a restore re-applies the transforms and the next draw recomputes the masks; a test proves it.

7. **Budgets**: the composer, the baked policy and the adapter enter the boot bundle (estimated a few KB gzip, inside the 700 KB IIFE budget; measured by `budget-check`). The walk chunk is re-measured after `bun run build:lib`; if it crosses its limit (last measured + 1 KB) from this legitimate growth, the limit is re-measured under that rule in this delivery.

## Risks / Trade-offs

1. [The light-order adapter mirrors three internals and breaks silently on an upgrade] → a component test builds mixed shadow, cookie, hidden-ancestor and layer setups and reads each light's diffuse back from pixels; the lighting standard already refuses another three revision.
2. [Uniform upload: three may skip re-uploading a material's uniforms between draws in one render] → masks are constant within one (render, camera); the nested-render test reads pixels from both renders.
3. [Program count: the first walk entry recompiles baked materials once (the walk rewrite is added), as for any material today] → unchanged behaviour; the swap frame compiles nothing, tested.
4. [Copied hooks resolve through the material they were installed for] → covered by the copy test; a copy of a disposed material still resolves through the `WeakMap` while the source is reachable through the hook's closure.

## Open Questions

None that change the specs or the tasks.
