# Brainstorm

## Problem

A light bake gives a shell surface (wall, floor, ceiling, skirting) a lightmap that already holds its diffuse indirect light and the diffuse light of the lamps that were baked. Drawn with the player's live lighting on top, such a surface is lit twice: the hemisphere, the ambient floor, the light probes, the room grid, the environment's diffuse, the fill light and the baked lamps all add again what the lightmap holds. The lighting must keep only what the bake left out on a marked surface (the direct sun with its shadows, specular reflections, live lamps) in every mode, without recompiling when a lamp is switched between baked and live.

## Related work

1. The lightmap binding change (in flight in a sibling worktree, `lightmap-calibration`) accepts a bake, binds RGBM lightmaps to cloned shell materials, decodes them through a shader transform and marks the clones and the baked lamps. It creates `src/render/baked-surface.ts` as a stub: `markBakedSurface`, `isBakedSurface`, `setLampBaked` as plain `userData` flags (`jeexBakedSurface`, `jeexBaked`) and `addShaderTransform(material, id, version, transform)` with `ShaderTransform = (shader: WebGLProgramParametersWithUniforms) => void`, composing by plain chaining. Its RGBM transform anchors on `#include <lightmap_pars_fragment>` or, once expanded, on `uniform float lightMapIntensity;`, and its preflight calls a material's hook with no renderer. Its bound clones copy the source material's `onBeforeCompile` and `customProgramCacheKey` by assignment. This change replaces the stub's bodies and keeps every signature.
2. The light temperature (landed): artificial lights carry `userData.artificialLight`; that tag is a tint classification, not a bake classification, and is not read here.
3. The walk sun factor (landed): the walk patch already scales the directional lights' direct light inside room boxes by `jeexSun`.

## Doubts

1. Can the live lamps' diffuse be dropped per light without a program per lamp state?
2. Which index does a given point or spot light get in three r186's uniform arrays, and does that survive shadows, cookies, hidden parents and camera layers?
3. Does zeroing the environment's irradiance also kill specular energy?
4. Can the probe-grid selection reject a marked material instead of a shader change?
5. Two transforms that each replace the same `#include` cannot both apply; how do the walk patch, the baked policy and the RGBM decode compose?
6. Which mode factors must a baked surface follow so editing, walk and captures agree?

## Approaches considered

1. **Per-light uniform masks in one shader variant per material** (partner): wrap only the `RE_Direct` call of the point and spot loops (after shadow and cookie) and mix the diffuse back to its value before the call by a per-light mask. Masks are uniforms rebuilt per render camera from three r186's light ordering. Cost: an adapter pinned to the installed three. Toggling a lamp is a uniform write.
2. **Separate render passes or layers per lamp class** (author): three does not filter lights per receiving mesh within one render; extra passes double the draw cost and the composition. Rejected.
3. **A define per lamp state** (author): every toggle recompiles; violates the no-recompile goal. Rejected.
4. **Exclude baked materials from the probe-grid selection** (author): the selection receives a position, not a material, cannot handle multi-material meshes, and three bypasses containment when one grid exists; the grid define stays scene-wide anyway. Rejected in favour of skipping the grid sample in the shader for marked materials.
5. **Zero `iblIrradiance`** (author): three r186's physical indirect specular uses it for multiple-scattering energy, so specular would darken. Partner: keep it and guard only the line that adds its diffuse share. Taken.
6. **One shader composer** (partner): every chunk rewrite registers as a transform with an id and a version; the composer expands the owned lighting chunks once, applies the transforms in a fixed order and builds the program key from their ids and versions. Taken; chaining hooks alone fails when two rewrites replace the same include.

## Decision

1. **Contract** (signatures fixed with the lightmap change): `src/render/baked-surface.ts` exports `markBakedSurface(material: MeshStandardMaterial)`, `isBakedSurface(material)`, `setLampBaked(light: PointLight | SpotLight, baked: boolean)` and `addShaderTransform(material, id, version, transform)`; the composer may live in `src/render/shader-compose.ts` and is re-exported, so every export is importable from `baked-surface.ts`. An unflagged lamp is live. Only the lightmap binding calls `setLampBaked(light, true)`; lamp builders stay unflagged.
2. **One composer.** `installWalkPatch` stops owning `onBeforeCompile` and `customProgramCacheKey`; every transform (box probe, baked, RGBM decode) registers through the composer, which expands its owned chunks before any transform runs and applies transforms once per compile in a fixed order: box probe, then baked, then the others in registration order. Later transforms receive the shader with the owned chunks already expanded. The key is built from the ids and versions only; no mask or mode value enters it.
3. **Baked point and spot diffuse**: per-light uniform masks (`jeexPointDiffuse[i]`, `jeexSpotDiffuse[i]`: 0 baked, 1 live) wrap only the `RE_Direct` call's diffuse inside three's point and spot loops (in braces, since the loops are unrolled), after the shadow and cookie factors. Masks are rebuilt per render camera (captures included, nested renders restored) from three r186.1's `WebGLLights` ordering: visible lights in traversal order respecting hidden ancestors and camera layers, a stable sort by `2 × castShadow + Boolean(map)` descending, then split by type. The adapter is pinned to the installed three and a test fails on an ordering change. Toggling changes uniforms only.
4. **Directional**: the fill light (`jeex-lighting-fill`, editing only) is dropped on baked surfaces; the sun is identified by its name, never by `castShadow`.
5. **Indirect**: on a baked surface, `irradiance` is zeroed after the begin chunk (ambient including the walk floor, hemisphere, light probes, grid), the grid sample is skipped and the grid-to-environment hand-over is off; the environment's diffuse share is dropped by guarding `reflectedLight.indirectDiffuse += indirectDiffuse` in the physical indirect specular; `iblIrradiance` stays for multiple scattering. Radiance and clearcoat radiance stay. The walk's environment diffuse scale is bypassed on baked surfaces. The grid selection is unchanged.
6. **Shadows**: sun shadow receiving is untouched.
7. **Mode parity**: the lightmap's contribution is scaled by the same interior factor as the direct sun (1 in the editing modes, the walk sun factor inside rooms in walk and tour) and that factor is 1 in grid and probe captures, as for the sun today. No other exposure compensation and no ambient-occlusion parity: walk keeps its post chain. Room reflection probes stay walk and tour only.
8. **Out of scope**: colour temperature on baked surfaces (a re-bake or a tint, later), transmissive shells, double occlusion by an AO map (the lightmap binding does not bind one on baked surfaces), bake invalidation.
9. **Tests** in a real WebGL context with float readback: a grey physical material with `specularIntensity` 0 for diffuse assertions; a zero lightmap with nonzero hemisphere, ambient, grid, environment and fill equals an independent sun-only reference on shadowed and lit pixels; baked, live and unflagged point and spot lamps; a nonzero lightmap adds as expected and is scaled in walk like the sun; specular highlights kept; mixed shadow and cookie ordering, a hidden ancestor, a camera layer; program count unchanged across mask toggles; context restore keeps masks and transforms. Small linear tolerance.

## Rejected

1. Separate passes per lamp class: double draw cost; three cannot filter lights per mesh.
2. A define per lamp state: recompiles on every toggle.
3. Grid selection by material: the selection sees positions only; the define is scene-wide.
4. Zeroing `iblIrradiance`: darkens specular multiple scattering.
5. Exposure compensation of the whole baked output and matching ambient occlusion across modes: not needed for the agreed parity, adds a second calibration.
6. Identifying the sun by `castShadow`: a host or later rig may cast shadows from another light.

## Process

Partner: an independent agent reading the code read-only, one round; its sketches were checked against the installed three r186.1 chunks (`lights_fragment_begin`, `lights_fragment_maps`, `lights_physical_pars_fragment`, `WebGLLights`). The lightmap change's stub was read to keep its signatures, its `userData` keys and its anchors.
