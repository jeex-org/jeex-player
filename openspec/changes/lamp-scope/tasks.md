# Tasks

Every behaviour change lands as a failing test first, then the code, as two commits (the red one names its failing line). Browser tests run on the affected files only, through the machine's heavy-job queue, on SwiftShader and on the GPU (the renderer actually got is recorded); walk is metered only once `walkLighting().state` is `live`. "Fresh bake" means the walk lighting restarted and reached `live` again.

## 1. Lamps reach the grid capture

- [ ] 1.1 Red: `src/render/walk-lighting/grid-bake.test.ts`: a slice sets every furniture mesh's layer mask to 0 and leaves its ancestors visible, restores every original mask (a non-default mask included) after the slice, and restores them when `grid.bake` throws; the furniture group is no longer in the visibility exclusions while mirrors and transmissive meshes still are; verify the new cases fail (`bun test src/render/walk-lighting/grid-bake.test.ts`).
- [ ] 1.2 Red: component test in `tests/component/walk-lighting.test.ts`: a room with one fact lamp whose light is a child of a mesh body; a rough grey card out of the lamp's direct reach (the gate is not in yet, so the card is shielded by geometry) reads brighter after a fresh bake with the lamp on than after one at zero intensity; the same with a built-in bank floor lamp; verify it fails on main (equal readings).
- [ ] 1.3 Implement the layer exclusion in `GridBake.step` and the furniture mesh list in `walk-lighting.ts`; verify 1.1 and 1.2 pass, and that the existing «Furniture by the wall», «Windowless room darker» and reflection-probe shade tests still pass on SwiftShader.

## 2. Source rooms

- [ ] 2.1 Red: `src/render/walk-lighting/lamp-rooms.test.ts`: a point inside one polygon answers that room's index; a point on a shared edge answers the room first in the order, on two calls; a point in an L-shaped room's second rectangle answers that room; a point in the wall margin inside the polygon answers the room; a point outside every polygon answers -1; `lampSignature` changes on a 2 mm move, a colour or intensity change, a removal and an addition, and not on a 0.4 mm move; verify it fails (no module).
- [ ] 2.2 Implement `lamp-rooms.ts` (pure); verify 2.1 passes and the render purity check still passes.
- [ ] 2.3 Red: walk lighting unit or component test: after `load`, every tagged artificial point light (fact and bank) carries `userData.jeexLampRoom` with its room's index or -2, an untagged point light carries none, and `collectLampLights()` still returns only the fact lights; verify it fails.
- [ ] 2.4 Implement the runtime inventory and the assignment on `load` and `restart`; verify 2.3 and `tests/component/lamp-lights.test.ts` pass.

## 3. Rooms in three's light order

- [ ] 3.1 Red: `src/render/light-order.test.ts` (or the existing adapter test): `lightMasks` answers `pointRoom` in the same order as `point` for shadow-casting lights listed first, a hidden ancestor, a light whose own layers fail the camera, and a light under a mesh whose layer mask is 0 (still collected); verify it fails.
- [ ] 3.2 Red: `tests/component/baked-surface.test.ts` gains the «Rooms follow the order» case (two point lights of different rooms, one casting a shadow, read back from pixels in walk); verify it fails.
- [ ] 3.3 Implement `pointRoom` in `light-order.ts` and the shared per-render updater used by the baked draw hook and the walk patch's draw hook; verify 3.1 passes and the whole `baked-surface.test.ts` and `baked-surface-walk.test.ts` pass (the latter in the serial GPU step).

## 4. The room gate

- [ ] 4.1 Red: `src/render/walk-lighting/box-probe-patch.test.ts`: the patched fragment text declares `jeexLampScope`, `jeexBoxRoom[ JEEX_MAX_BOXES ]` and `jeexPointRoom[ NUM_POINT_LIGHTS ]` (the latter under `NUM_POINT_LIGHTS > 0`), records `jeexRoom` in `jeexLocate`, gates `directLight.color` right after `getPointLightInfo`, and the baked transform still finds its point-light anchor after the walk transform ran; `setRoomBoxes` writes each box's room index; `WALK_TRANSFORM.version` is 6; verify it fails.
- [ ] 4.2 Red: component tests in `tests/component/walk-lighting.test.ts` on a two-room synthetic plan (shared wall with one doorway, one material on walls of both rooms): «Closed wall» (the far-side card reads the same lamp on and at zero, each after a fresh bake, the near-side card is lit), «Doorway» (B's probe and grid see A's lit wall, B's floor by the doorway takes no direct light from A), «Shared material in two rooms», «Camera position does not matter» (A's wall from A and from B within the tolerance), «Lamp in no room», «Warm-up» (gated in the direct look before `live`), and the walk «Restore» with a lamp near a wall (orbit pixel-identical); verify each fails on main where it should (closed wall, doorway, shared material, no room, warm-up) and record the failing lines.
- [ ] 4.3 Red: component test: a lamp lights the floor across the box boundary of a split open-plan room with no step larger than between neighbouring pixels elsewhere; and «Walking through rooms»: after the bake the camera walks from one room to the other and back over several frames with the program count constant; verify the seam case fails if the gate were per box (write it against the delivered rule; it may pass at once, then say so in the report).
- [ ] 4.4 Implement the uniforms, the receiver room, the gate, the scope switch in the walk rig (on from walk entry through the warm-up and captures, off on exit) and the version bump; verify 4.1–4.3 pass on SwiftShader and on the GPU, and that `walk-lighting.test.ts`, `walk-glossy.test.ts` (GPU), `lamp-shade-emissive.test.ts`, `light-temperature.test.ts` and `hdri-walk.test.ts` run green or report a calibration conflict (group 7), never a threshold change.

## 5. Invalidation

- [ ] 5.1 Red: component tests: a lamp moved in walk to another room makes every grid and then every probe re-bake (bake counters), its old room's grid card returns to its lamp-off reading within the tolerance and its new room's lamp-lit card is lit; a lamp removed and a lamp swapped to another lit variant do the same; a temperature change in walk, once rested, re-bakes grids then probes with the tinted lamps; a furniture move without a lamp still re-captures only the probes of today's rule (existing «Edit in walk»); «Lamp moved to another room» compiles no program beyond the first warm-up; verify the lamp cases fail on main.
- [ ] 5.2 Implement the lamp signature check in `refresh`, `relight()` as a restart, and update the controller's relight wording; verify 5.1 and `src/app/walk-lighting-controller` and `light-temperature-control` unit tests pass.

## 6. Concave rooms

- [ ] 6.1 Script or test that lists every room with more than one box in the demo apartment and the plan fixtures, the lamps inside each, and whether a surface behind an inner corner lies within a lamp's cutoff; for each such case meter that surface in walk lamps-on vs daylight-only (fresh bakes); verify by the written list and readings.
- [ ] 6.2 If a case shows a visible leak: red component test for «L-shaped room», then the segment test for multi-box rooms (uniform-driven loop), with its display and bake cost measured; otherwise record "no supported case" with the list; verify by the test or the recorded list.

## 7. Calibration

- [ ] 7.1 Before (main) and after (this branch), daylight-only and lamps-on, each after a fresh bake, on a hardware renderer, with the renderer string, lamp intensities and temperature recorded: fill every row of design.md's calibration table; also the lamp-isolated reading (direct, grid, combined); verify the table is complete in the report.
- [ ] 7.2 If the corrected ceiling leaves 1.3–1.6 or breaks R ≥ G ≥ B: re-record the white balance source by the existing calibration procedure (red first: the ceiling test with the new recorded value), never moving the target band; verify `walk-glossy.test.ts` on the GPU.
- [ ] 7.3 Any other target missed: no tuning of exposure, ambient floor, sun factor, lamp units or emissive cap without an independent daylight measurement that justifies it, and never of gloss thresholds, poses, masks or roughness; record the conflict with its numbers for an acceptance decision; verify by the report.
- [ ] 7.4 Costs before and after, lamps on: bake time and frames, warmed display frame ms over forced frames, draw calls, program count; verify recorded with the renderer.

## 8. README

- [ ] 8.1 Update the lamp lights «Known costs and limits» and the walk lighting «How» paragraphs: lamps feed the room grids, stop at their room boundary in walk and tour, still reach through walls in the editing modes, a lamp edit or temperature change in walk re-bakes, the concave-room limit unless 6.2 delivered the segment test; verify against the README scenarios of `player-lamp-lights` and `walk-room-lighting` (and the spelling check passes).

## 9. Integration

- [ ] 9.1 Re-measure the walk-post lazy chunk if it grew and keep it under the repo's budget rule (measured + 1 KB, never raised by guess); verify the budget check passes.
- [ ] 9.2 `scripts/check.sh fast` and the full `bun test` green; verify by their last lines in the report.
- [ ] 9.3 Shots of the demo living room by daylight and in the evening with lamps on, and of a doorway with a lamp-lit neighbouring room, each taken after `walkLighting().state === 'live'`; verify the files exist.

## Workflow follow-up

- Independent review of these artifacts before implementation.
- After implementation: the review of record, the security review and one full gate through the gate queue, then archive the change and move the internal artifacts out of the repository before the delivery commit.
