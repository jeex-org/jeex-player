# Design

## Context

A baked surface (`render/baked-surface.ts`) takes its diffuse indirect light only from its lightmap; the live look of the same room adds the hemisphere, the environment diffuse at 1.8 and the fill to every face, as if the room stood in the open. The bake holds the honest light of a closed room, so a baked shell reads several times darker. The decode is correct and applies π once: the bake stores irradiance / π, names an intensity of π, three adds `texel × intensity` to the irradiance and the Lambert term divides by π once. In walk the baked policy also multiplied the lightmap by the walk's interior sun factor (1/3.5), which belongs to direct sunlight only.

## Goals / Non-Goals

**Goals:**
- In a baked room, the mean wall reading within ±20 % of the live look of the same mode, in orbit and in walk at the same pose, with the floor keeping a warm cast and nothing clipping.
- The lightmap treated as indirect light in every mode: no walk sun factor on it.

**Non-Goals:**
- Baked light on furniture (per-room probes for dynamic objects): a later change; the gains shrink then.
- Any change of the bake's units, the decode or the live rigs.

## Decisions

1. **Walk factor removed.** `baked-surface-glsl.ts` no longer multiplies `irradiance` by `jeexSunScale` after the maps chunk. The walk patch declares `jeexSunScale` again only beside the directional light, where its own direct-sun scale uses it, and drops `JEEX_WALK_LIGHTING`, which nothing read any more; its transform version goes from 2 to 3.
2. **Gain data.** `LIGHTING_STANDARD.baked.exposure = { editing, walk }`, plain data in the frozen standard, published through `jeex-viewer/lighting` with no three.js at run time. Each is a gain on the lightmap of a baked surface only.
3. **Gain in the shader.** Shared uniforms `jeexBakedGain` (the mode's gain) and `jeexBakedEditingGain` beside the light masks; after the maps chunk, where `irradiance` holds the lightmap alone, `irradiance *= mix( jeexBakedEditingGain, jeexBakedGain, jeexInRoom )` where the walk patch located the fragment (`JEEX_MAX_BOXES` defined), `irradiance *= jeexBakedGain` elsewhere. Outside every room box a baked surface thus keeps the editing gain, and the walk's outside compensation gives it the editing look, as on a facade. The baked transform's version goes from 1 to 2.
4. **Gain per scene, chosen by the mode.** `setBakedLightMode(scene, 'editing' | 'walk')` records the mode of a scene; the draw hook that already resolves the light masks per render also sets the uniform from the rendered scene's mode (`editing` when none was recorded). Per scene, not per page, so two viewers on one page in different modes keep their own gains; per render, so a capture nested in a render uses the same scene's value. No program changes with the mode.
5. **Who sets the mode.** The walk rig (`walk-lighting/walk-rig.ts`) in `reapply`: `walk` in the `walk` and `capture` states (a capture records what walk shows: the grid and the probes feed walk's furniture light and reflections), `editing` otherwise, and `editing` on dispose.
6. **Calibration.** Both gains metered on the demo flat with its first full bake through the debug light-bake hook, on the GPU, at the living-room pose `4.8, 1.6, 8.6 → 1.2, 1.2, 6.2` in walk and in orbit: mean sRGB luma of two wall patches and one floor patch, the floor's R/B ratio and the share of clipped pixels, against the live look of the same mode. Result: `editing` 80, `walk` 6.4 (numbers in the delivery report). The code comment says they shrink once furniture takes baked light.
7. **Version.** `LIGHTING_STANDARD_VERSION` stays 1. The rule raises it when an existing rig value changes; consumers key previews of the editing look (asset review, store previews) by it, and none of those contains a baked surface. The new data changes only how baked shells look, no baked project is shipped yet, and a bake records the standard version of its light inputs (sun, sky, lamps), which the gains do not touch.

## Evidence

- Hue: on the baked floor in orbit, with the environment's specular and its multiple scattering zeroed in a scratch probe, the floor read luma 32 with R/B 57; with them, 77 with R/B 1.3. The neutral studio reflection outweighed the warm diffuse term; with the editing gain the floor reads R/B about 2, warmer than live (1.6).
- Walk factor: with the factor removed and no gain, the baked wall in walk rose from 64 to 69: the lightmap is a small share there, the live floor lamp lights most of the wall.

## Risks / Trade-offs

- An editing gain of 80 is several times the first estimate (20 to 25): the live look's diffuse is stronger than an open sky (environment at 1.8, hemisphere and fill together), and the display transform compresses the top. It is metered, not guessed, and stays a single number per mode.
- One gain for all baked surfaces: a pale floor by a sunny entrance reads close to white in the dollhouse overview at the editing gain; nothing clips on the metered pose.
