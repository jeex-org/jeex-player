# Tasks

TDD: every behaviour change writes or extends its test first, sees it fail, then makes it pass.

## 1. Walk factor and gain

- [x] 1.1 Standard data `LIGHTING_STANDARD.baked.exposure` (design 2). Test first in `src/lighting/lighting-standard.test.ts`: positive gains, frozen, version stays 1.
- [x] 1.2 Baked policy (design 1, 3, 4). Tests first in `src/render/baked-surface.test.ts`: the shader multiplies by `jeexBakedGain` after the maps chunk and never by `jeexSunScale`; the mode per scene gives the editing gain by default and the walk gain once set, back to editing when reset.
- [x] 1.3 Walk rig (design 5). Test first in `src/render/walk-lighting/walk-rig.test.ts`: walk and capture set the walk mode, editing and dispose set it back.
- [x] 1.4 Component test `tests/component/baked-surface-walk.test.ts`: a baked wall in walk reads its editing reading times the walk gain over the editing gain, not times the walk sun factor; a capture carries the walk gain; an unbaked card does not move with the gains. Program keys in `src/lightmap/lightmap-binding.test.ts` follow the new transform version.
- [x] 1.5 Comments: `box-probe-patch.ts`, `walk-lighting-tuning.ts` no longer say the lightmap takes the sun factor.
- [x] 1.6 Outside every room box the editing gain (review F1). Test first in `tests/component/baked-surface-walk.test.ts`: outside every box the walk reading is the editing reading under the outside compensation, the capture reading equals the editing reading, and the surface reads in walk as in orbit once the walk exposure is applied; `src/render/baked-surface.test.ts` pins the mix by `jeexInRoom`. The walk patch drops the unread `JEEX_WALK_LIGHTING` and declares `jeexSunScale` beside the directional light again (transform version 3).

## 2. Calibration

- [x] 2.1 Meter live and baked, orbit and walk, before and after (design 6); set both gains; check the floor R/B and clipping.
- [x] 2.2 CHANGELOG entry.
- [x] 2.3 Acceptance: `bun run typecheck`, `bun run lint`, `bun run format:check`, `bash scripts/check.sh fast`, `build:lib` for the lighting entry budget.
