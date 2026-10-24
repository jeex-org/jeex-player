# Tasks

Every behaviour change lands as a failing test first, then the code. Browser tests run on the affected files only, through the machine's heavy-job queue, on SwiftShader and on the GPU where the task says so; walk metering only once the walk lighting reports `live`.

## 1. Probe placement with 3D clearance

- [ ] 1.1 Red: `room-volumes.test.ts` cases for a floor lamp box at the room centre with a qualifying candidate (probe ≥ `probeClearanceM` from it), a 0.8 m sofa at the centre (probe equals the empty room's), a room with no qualifying candidate (highest min(furniture clearance, edge distance), then score, then traversal order), and determinism (two runs equal); verify they fail on today's placement where expected (`bun test src/render/walk-lighting/room-volumes.test.ts`).
- [ ] 1.2 Add `FurnitureBox` and `probeClearanceM: 0.5`; implement the clearance, the qualifying rule and the fallback in `probePoint`; update the existing footprint test to boxes; verify 1.1 and the whole file pass.
- [ ] 1.3 Red then green: `walk-lighting-wiring` fills `minY`/`maxY` from each furniture item's bounds; verify with its unit test (or a new one) that a known item's box carries its height.
- [ ] 1.4 Measure the placement time on the demo plan once (unit level) and record it for the report; verify the number is written down.

## 2. Placement refresh after furniture edits

- [ ] 2.1 Red: controller unit test: a debounced refresh hands the lighting the current document with the scope; verify it fails on the one-argument contract.
- [ ] 2.2 Change the handle contract to `refresh(scope, doc)` and pass `deps.document()`; verify 2.1 and the controller's other tests pass.
- [ ] 2.3 Red: component test in `tests/component/walk-lighting.test.ts`: in walk, move the living room's floor lamp to within 0.2 m of the probe point; after the debounce the capture is called at a point ≥ 0.5 m from the lamp's new box and every living-room box's `jeexProbe` equals it; at a resting camera the refresh causes a display draw (`renderDemand().draws` grows) and the view then rests; an edit that moves no probe point re-captures only its room at the same point; verify it fails today.
- [ ] 2.4 Red: `WalkLighting` tests with a capture spy (component level, small synthetic rooms): an edit that moves another room's probe point adds that room to the re-capture set at its new point; an edit during the initial bake restarts it and every probe is captured at the current points; a refresh whose document gives different projection boxes calls `load(doc)`; verify each fails today.
- [ ] 2.5 Implement the refresh in `WalkLighting.refresh` (recompute, compare, write positions, `setRoomBoxes`, recapture scope ∪ moved; a box change reloads; the early-refresh restart uses current points); update the «edit in walk» test's expectation to the new contract; verify 2.3, 2.4 and the existing edit test pass on SwiftShader.
- [ ] 2.6 After the rebase onto a main that contains the host sky: a placement refresh with an HDRI installed keeps the atlas's fixed mip, its tile-size check and the rig's state transitions; verify red/green on that test (not before the host sky is on main).

## 3. Gloss proof in the demo living room

- [ ] 3.1 Component test: demo living room in walk with the lighting live, the living probe point ≥ 0.5 m from the floor lamp box (the «Demo living room» scenario); verify it passes after group 1 (red on main: record the failing line).
- [ ] 3.2 GPU measurement test (asserts a hardware renderer string, skips with a reason on software): demo living floor black, non-metal, map-free at roughness 0.07 and 0.6, recorded pose, resolution and floor mask, contrast p99/median of linear specular luminance; assert 0.07 ≥ 2.5 × 0.6; verify red before group 1 and green after, record both numbers and the renderer.
- [ ] 3.3 GPU measurement test (same renderer assertion): a recorded window-band pose, the same black non-metal map-free floor at roughness 0.07; the band in the window's column is brighter than the floor beside it; verify red before group 1 and green after, record the numbers and before/after shots.

## 4. White balance

- [ ] 4.1 Red: `src/render/white-balance.test.ts`: identity at degree 0 and for a source equal to the display white; the source white maps to the display white at full degree and at the source's luminance; `y M = y` for any degree (before clipping); the matrix equals an independently written reference computation for a fixed source and degree; verify it fails (no module).
- [ ] 4.2 Implement `src/render/white-balance.ts` (pure); verify 4.1 passes and the purity test still passes.
- [ ] 4.3 Red: `tests/component/walk-post.test.ts`: a flat patch of known linear colour through the chain with a non-identity matrix displays as the display transform of the clamped matrix product (1/255); the white balance adds no pass and no target; a missing shader anchor throws; verify it fails.
- [ ] 4.4 Implement `WalkOutputPass`, the `whiteBalance` option and read-only field of `WalkPost` and the `PostProcessor` contract field (default from the tuning, identity until calibrated); pass identity in the existing comparisons with the direct path (open floor, mirror); verify 4.3 and the whole walk-post file pass on SwiftShader.
- [ ] 4.5 Red then green: panorama display pass with a matrix (`panorama.test.ts`): a known cube colour comes out as the display transform of the clamped product; without a matrix the output is unchanged; the panorama command passes the chain's matrix in walk and none outside; implement in `still-capture.ts` `displayFragment`/`displayMaterial`, `panorama.ts` and `capture-commands.ts`; verify on SwiftShader.
- [ ] 4.6 Component test: in walk a probe captured with the matrix set equals one captured at identity; an orbit frame before and after walk stays pixel-identical; a still's neutral patch ratios match the screen's within 2 %; a panorama's and a still's neutral patch ratios match within 2 %; verify green.
- [ ] 4.7 Calibrate on the GPU at the demo walk start (design, decision 3), metering the linear domain (the half-float buffer, or bytes decoded with the sRGB EOTF and divided by the exposure actually set): meter `source`, choose the degree for ceiling R/B 1.45, write both into `WALK_POST_TUNING.whiteBalance` with the measurement comment (domain and exposure included); verify the «Ceiling at the walk start» and «Coloured furniture and window» scenarios as a component test (red with the identity default, green after), record ceiling R/B and colour before/after.

## 5. Integration checks

- [ ] 5.1 No extra GPU cost: atlas `memoryBytes`, chain passes and targets unchanged against main; verify from the recorded stats.
- [ ] 5.2 Chrome and canvas e2e baselines of the editing modes pass unchanged on the GPU; walk baselines that change because of the white balance are listed, not re-shot.
- [ ] 5.3 `scripts/check.sh fast` green; tuning comments and any repository docs describing the walk probes and the walk output updated; verify by reading the diff.

## Workflow follow-up

- Independent review of these artifacts before implementation.
- Rebase onto the orbit-on-demand landing before the gate.
- Review of record, security review, one full gate through the machine's gate queue, owner approval, then archive the change.

## 5b. Zero bump normal in captures

- [x] 5b.1 Red: the WC probe captured at its new point holds no NaN (SwiftShader: 22 980 NaN values); green after the walk transform guards the bump normalisation; the WC calibration test is green again.

## 6. Walk emissive cap (added by jeex-common after the Sol round)

- [ ] 6.1 Red: adapt the lamp-shade emissive test (one mount per finish, walk and editing readings) into the branch, crediting the jeex-player session; verify it fails on walk (ivory 2.30, opal 3.70, warm lamp 6.66).
- [ ] 6.2 Implement the cap in the walk transform through the composer, a rig-set uniform, the cap in the walk tuning, `WALK_TRANSFORM.version` bumped once; choose the cap by measurement; verify 6.1 green on the GPU and the editing readings unchanged, or stop and report the numbers if no single cap meets both bounds.
- [ ] 6.3 Re-meter the ceiling and the living probe blob after the cap and redo the white-balance calibration (4.7) on the new readings.
