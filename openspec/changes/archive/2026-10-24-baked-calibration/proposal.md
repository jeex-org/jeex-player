## Why

A baked room reads several times darker than the same room lit live, and its floor turns cold, because the live look lights every face as if in the open while the bake holds the honest light of a closed room. In walk the lightmap is also divided by the walk exposure, though it is indirect light. Baked rooms need to read like live rooms of the same mode before a baked project can ship.

## What Changes

- The lightmap of a baked surface is no longer scaled by the walk's interior sun factor: factor 1 in every mode, shown at the walk exposure in walk and tour.
- New lighting-standard data `LIGHTING_STANDARD.baked.exposure` with two gains on the lightmap of a baked surface: `editing` (editing modes) and `walk` (walk, tour and their grid and probe captures). Live objects and the sky are not affected.
- The gains are metered on the demo flat's bake against the live look of the same mode (wall within 20 %, floor keeps its warm cast, nothing clips).
- `LIGHTING_STANDARD_VERSION` stays 1 (design, «Version»).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `baked-surface`: «Mode parity of baked light» now states the per-mode gain and drops the walk sun factor.
- `walk-room-lighting`: «Baked surfaces in walk and tour» drops the walk sun factor on the lightmap.
- `lighting-standard`: «Published description and version» names the baked-interior gains and why the version stays.

## Impact

- `src/lighting/lighting-standard.ts` (new data), published through `jeex-viewer/lighting`.
- `src/render/baked-surface.ts`, `src/render/baked-surface-glsl.ts` (the gain uniform, the walk scale removed, transform version raised).
- `src/render/walk-lighting/walk-rig.ts` (tells the baked policy the mode), comments in `box-probe-patch.ts`.
- Tests: `src/render/baked-surface.test.ts`, `src/lightmap/lightmap-binding.test.ts`, `tests/component/baked-surface-walk.test.ts`.
