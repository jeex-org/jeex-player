# Proposal

## Why

Walk and tour show a flat gradient through the windows and light the apartment from a neutral studio environment and an artistic sun, so a host with a real sky panorama for the scene's time of day cannot make the view look like that day. The walk lighting, the lazy walk chunk and the scene's site orientation are now in place, so a host-supplied sky can be shown and lit from without touching boot or the editing modes.

## What Changes

1. New host option `lighting.hdri`: a partial record keyed by sun preset (`morning`, `noon`, `evening`). Each entry holds an environment URL (a high-dynamic-range gain-map JPEG, 1K), a sky URL (a display AVIF) and the sun facts measured at import: azimuth, elevation, linear colour, share of horizontal irradiance. Validated with Zod at option resolution; an invalid entry is dropped with one option warning. Typed object only: no query parameter, no attribute, no scene field.
2. On the first walk or tour entry the active preset's pair is fetched and decoded in the lazy walk chunk; until it is ready the current look stays. Editing modes never fetch and keep their look exactly.
3. In walk and tour the windows show the panorama, rotated so its sun stands at the preset's azimuth from the scene's north; the environment, the exterior and the room grid and probe captures are lit by the HDRI; the analytic sun takes the panorama's elevation and colour and a calibrated intensity; the gradient fog is off.
4. The probe atlas's sampling no longer depends on the environment's size.
5. The lighting standard publishes the HDRI calibration values (environment gain, loader compensation, sky brightness); the recipe's values and the appearance version stay as they are.
6. Baked apartments show the panorama through the windows but keep their recorded daylight, and say so once in the viewer's diagnostics.
7. A failed fetch or decode reports once and keeps the recipe; preset changes, walk/tour switches, context loss and unmount release what they must.
8. Synthetic gain-map and AVIF fixtures with their generator; the walk chunk's budget is re-measured.

No breaking change: without the option nothing changes.

## Capabilities

### New Capabilities

- `hdri-sky`: the host's HDRI option, its validation and preset selection, loading and lifetime, the visible sky, the HDRI environment and sun in walk and tour, rotation, fog, fallback, baked apartments and diagnostics.

### Modified Capabilities

- `walk-room-lighting`: outside the rooms the exterior light comes from the HDRI when one is installed; fragments outside every room box reflect the HDRI; the probe atlas is sampled independently of the environment's size.
- `lighting-standard`: the player may light walk and tour from an HDRI over an attached apartment rig; the published description gains the HDRI calibration values and the version stays 1.
- `apartment-sun-shadow`: with an HDRI installed in walk and tour the sun takes the HDRI's elevation, colour and intensity; elsewhere it keeps the preset.
- `walk-post-processing`: the panorama's brightness is set through the chain's output pass under an explicit policy, and installing or releasing an HDRI redraws walk and tour.

## Impact

1. Code: `src/app/viewer-options.ts` and a new option schema module; the walk lighting controller and the walk chunk (`src/render/walk-post.ts`, `src/render/walk-lighting/`), a new HDRI module inside the walk chunk; the walk rig, the box-probe patch and the room probes; `src/lighting/lighting-standard.ts`; the debug surface.
2. Public API: one new optional mount option, documented in the README and the published options JSON Schema; one new debug read.
3. Dependencies: none new; three's `UltraHDRLoader` addon from the installed three.
4. Bundles: the walk chunk grows by the decoder and the wiring and its allowance is re-measured; boot grows only by the option's validation; the lighting entry keeps its limit and gate.
5. Tests: new unit and browser component tests on synthetic fixtures; chrome and canvas end-to-end baselines unchanged.
