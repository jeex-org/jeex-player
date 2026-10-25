# Tasks

Every behaviour change lands as a failing test first, then the code, as two commits (the red one names its failing line). Browser tests run on the affected files only, through the machine's heavy-job queue, on SwiftShader and on the GPU (the renderer actually got is recorded); walk is metered only once `walkLighting().state` is `live`. "Fresh bake" means the walk lighting restarted and reached `live` again. Every pixel oracle records its mask, its domain (linear before tone mapping unless stated) and its numerical tolerance in the test.

## 1. Lamps reach the grid capture

- [ ] 1.1 Red: `src/render/walk-lighting/grid-bake.test.ts`: a slice sets every furniture renderable's layer mask to 0 (a transmissive body and a mirror under the furniture group included) and changes no `visible` under the furniture group, restores every original mask (a non-default mask included) after the slice and when `grid.bake` throws; mirrors and transmissive meshes outside the furniture group are still hidden by visibility; verify the new cases fail (`bun test src/render/walk-lighting/grid-bake.test.ts`).
- [ ] 1.2 Red: component test in `tests/component/walk-lighting.test.ts`: a room with one fact lamp whose light is a child of a mesh body; a zero-specular grey card beyond the lamp's cutoff, lamp-lit shell in view of the grid probes; the card's linear reading is higher after a fresh bake with the lamp on than after one at zero; the same with the light under a transmissive body, and with a built-in bank floor lamp; verify it fails on main (equal readings).
- [ ] 1.3 Implement the layer exclusion in `GridBake.step` and the furniture renderable list in `walk-lighting.ts`; verify 1.1 and 1.2 pass, and that the existing «Furniture by the wall», «Windowless room darker» and reflection-probe shade tests still pass on SwiftShader.

## 2. Source rooms

- [ ] 2.1 Audit: place every supported wall-mounted lamp fact (the bundled lamp fixtures and the playground lamps) against a wall and check its emitter against the room polygon; verify by a recorded list. An emitter outside its polygon by mistake is reported for a fact correction at its source; if a supported asset needs its emitter in the wall on purpose, stop and ask before adding any mounting-side rule.
- [ ] 2.2 Red: `src/render/walk-lighting/lamp-rooms.test.ts`: a point inside one polygon answers that room's index; a point on a shared edge answers the room first in the order, on two calls; a point in an L-shaped room's second rectangle answers that room; a point inside the polygon within the wall margin answers the room; a point 5 mm outside every polygon answers -1 (no nearest room); `lampSignature` changes on a 2 mm move, a colour or intensity change, a removal and an addition, and not on a 0.4 mm move; verify it fails (no module).
- [ ] 2.3 Implement `lamp-rooms.ts` (pure); verify 2.2 passes and the render purity check still passes.
- [ ] 2.4 Red: walk lighting test: after `load`, every tagged artificial point light (fact and bank) carries `userData.jeexLampRoom` with its room's index or -2, an untagged point light carries none, and `collectLampLights()` still returns only the fact lights; verify it fails.
- [ ] 2.5 Implement the runtime inventory and the assignment on `load` and `restart`; verify 2.4 and `tests/component/lamp-lights.test.ts` pass.

## 3. Rooms in three's light order

- [ ] 3.1 Red: the light order adapter's unit test: `lightMasks` answers `pointRoom` in the same order and length as `point` for shadow-casting lights listed first, a hidden ancestor, a light whose own layers fail the camera, and a light under a mesh whose layer mask is 0 (still collected); verify it fails.
- [ ] 3.2 Red: `tests/component/baked-surface.test.ts` gains «Rooms follow the order» (two point lights of different rooms, one casting a shadow, read back from pixels in walk, also after a nested render returns) and «Lamp under a mesh hidden from the capture»; verify they fail.
- [ ] 3.3 Implement `pointRoom` in `light-order.ts` and the shared per-render updater used by the baked draw hook and the walk patch's draw hook; verify 3.1 and 3.2 pass and the whole `baked-surface.test.ts` and `baked-surface-walk.test.ts` pass (the latter in the serial GPU step).

## 4. The room gate and the receiver room

- [ ] 4.1 Red: `src/render/walk-lighting/box-probe-patch.test.ts`: the patched fragment text declares `jeexLampScope`, `jeexBoxRoom[ JEEX_MAX_BOXES ]` and `jeexPointRoom[ NUM_POINT_LIGHTS ]` (the latter under `NUM_POINT_LIGHTS > 0`), records `jeexRoom` in `jeexLocate` with `≥ 0` inclusion, the second-push owner and the lower-index tie, keeps `jeexInRoom` strict, gates `directLight.color` right after `getPointLightInfo`, and the baked transform still finds its point-light anchor; `setRoomBoxes` writes each box's room index; `WALK_TRANSFORM.version` is 6; verify it fails.
- [ ] 4.2 Red: component tests on a two-room synthetic plan (shared wall with one doorway, a window, one material on walls of both rooms): «Direct light rejected beyond a wall» (one kept grid, lamp at authored intensity vs zero, zero-specular far-side card equal within tolerance, near side differs), «Doorway» (B's probe and grid see A's lit wall; with B's grid kept, B's floor by the doorway equal with A's lamp on and at zero), «Shared material in two rooms», «Camera position does not matter» (zero-specular card on A's wall read from A and from B), «Lamp in no room», «Warm-up» (gated in the direct look before `live`) and the walk «Restore» with a lamp near a wall (orbit pixel-identical); verify each fails on main where it should and record the failing lines.
- [ ] 4.3 Red: receiver room rendered tests, each in display and in a reflection capture read back: a door jamb on the shared centreline (lower room index), a closed door leaf between two lit rooms (each face only its own room's lamp), a window reveal (inside part lit by the room lamp, part beyond every box unlit), a cabinet against the shared wall (only its own room); verify they fail on main.
- [ ] 4.4 Red: component tests: a lamp lights the floor across the box boundary of a split open-plan room with no step larger than between neighbouring pixels elsewhere, and «Walking through rooms» (program count constant with an unchanged light configuration); write them against the delivered rule (they may pass at once; then say so in the report).
- [ ] 4.5 Implement the uniforms, the receiver room, the gate, the scope switch in the walk rig (on from walk entry through the warm-up and captures, off on exit) and the version bump; verify 4.1–4.4 pass on SwiftShader and on the GPU, and that `walk-lighting.test.ts`, `walk-glossy.test.ts` (GPU), `lamp-shade-emissive.test.ts`, `light-temperature.test.ts` and `hdri-walk.test.ts` run green or report a calibration conflict (group 7), never a threshold change.
- [ ] 4.6 Red then green: the light-count lifecycle test goes from no lamp to one to several and back to none in walk, re-baking after each, asserting the expected lamp pixels in each state (also after a nested render returns) and no WebGL error; programs are counted only across unchanged configurations.

## 5. Invalidation

- [ ] 5.1 Red: `src/app/walk-lighting-scope.test.ts`: an asset edit whose room the updated model cannot name (removed, or moved out of every room) yields a non-null scope with `lamps` set; every asset edit sets `lamps`; verify it fails.
- [ ] 5.2 Red: component tests through the real move and remove commands: a lamp moved to another room, a lamp moved out of every room, a lamp removed (the last lamp included) and a lamp swapped to another lit variant each re-bake every grid and then every probe (bake counters), and the lamp lights directly only its new room or none; a furniture move without a lamp still re-captures only today's probes («Edit in walk»); «Lamp moved to another room» compiles no program beyond the first warm-up; verify the lamp cases fail on main.
- [ ] 5.3 Red: «No stale lamp light» on its own: after removing a lamp in walk and the re-bake, every grid's coefficients equal those of a fresh bake of the scene loaded without that lamp within the recorded tolerance; verify it fails on main.
- [ ] 5.4 Red: temperature: a change in orbit after a walk session runs no bake in orbit, and the walk that turns live on entry shows the new tint in a grid card (never a live frame with the old one); a change during the initial bake restarts it and turns live with the new tint; setting the temperature the lighting was baked with re-bakes nothing; verify each fails on main where it should (controller unit tests plus one component test).
- [ ] 5.5 Implement the `lamps` scope flag, the signature check in `refresh`, `relight()` as a signature-checked restart, the controller's immediate hand-over of a pending relight on the first eligible frame, and the controller's doc wording; verify 5.1–5.4 and the controller and `light-temperature-control` unit tests pass.

## 6. Concave rooms

- [ ] 6.1 Audit every room with more than one box in the demo apartment and the plan fixtures: the lamps inside, and whether a surface behind the room's inner corner lies within a lamp's cutoff; meter each such surface in walk (decomposition `C − B` of group 7, direct only); verify by the recorded list and readings.
- [ ] 6.2 A visible leak in a supported scene: stop and report the case with a containment method shown correct for it and its estimated cost, before building it. No leak: record "no supported case" with the list, and the README states the limit (group 8).

## 7. Calibration

- [ ] 7.1 Before (main) and after (this branch), daylight-only and lamps-on, each after a fresh bake, on a hardware renderer, with the renderer string, lamp intensities and temperature recorded: fill design.md's calibration table, every cell marked acceptance or diagnostic as there; verify the table is complete in the report.
- [ ] 7.2 The lamp decomposition: readings `A` (fresh lamp-off bake), `B` (lamps-on bake, direct suppressed) and `C` (same grid, direct on) on a zero-specular card, with mask and domain; bounce, direct and combined from their differences; verify recorded.
- [ ] 7.3 Re-record the ceiling's raw R/B as the measured default-state baseline (red first: the ceiling test against the new recorded value), with its evidence; re-record the white balance source by the existing procedure only if the corrected ceiling leaves 1.3–1.6 or breaks R ≥ G ≥ B; verify `walk-glossy.test.ts` on the GPU.
- [ ] 7.4 Any other acceptance target missed: a parameter changes only on evidence that fits it (shade readings for the emissive cap, daylight readings for exposure, ambient floor and sun factor; lamp units never); gloss thresholds, poses, masks and roughness never move; a conflict goes into the report with its numbers for an acceptance decision; verify by the report.
- [ ] 7.5 Costs before and after, lamps on: wall-clock time to `live` for a cold and a warm entry, temperature-settle-to-live, the worst slice ms, `bakeMs`/`bakeFrames`/`probeMs`/`probeFrames`, warmed display frame ms over forced frames, draw calls and program count; no cost conclusion beyond the numbers; verify recorded with the renderer.

## 8. README

- [ ] 8.1 Update the lamp lights «Known costs and limits» and the walk lighting «How» paragraphs: lamps feed the room grids, stop at their room boundary in walk and tour, still reach through walls in the editing modes, a lamp edit or temperature change in walk re-bakes, a lamp emitter outside every room lights nothing in walk, and the concave-room limit unless 6.2 led to a fix; verify against the README scenarios of `player-lamp-lights` (and the spelling check passes).

## 9. Integration

- [ ] 9.1 Re-measure the walk-post lazy chunk if it grew and keep it under the repo's budget rule (measured + 1 KB, never raised by guess); verify the budget check passes.
- [ ] 9.2 `scripts/check.sh fast` and the full `bun test` green; verify by their last lines in the report.
- [ ] 9.3 Shots of the demo living room by daylight and in the evening with lamps on, and of a doorway with a lamp-lit neighbouring room, each taken after `walkLighting().state === 'live'`; verify the files exist.

## Workflow follow-up

- After implementation: the review of record, the security review and one full gate through the gate queue, then archive the change and move the internal artifacts out of the repository before the delivery commit.
