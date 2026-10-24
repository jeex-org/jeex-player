# Tasks

Every behaviour change lands as a failing test first, then the code. Browser tests run on the affected files only, through the machine's heavy-job queue, on SwiftShader and on the GPU where the task says so; walk metering only once the walk lighting reports `live`.

## 1. Probe placement with 3D clearance

- [ ] 1.1 Red: `room-volumes.test.ts` cases for a floor lamp box at the room centre (probe ≥ `probeClearanceM` from it), a 0.8 m sofa at the centre (probe equals the empty room's), a room with no clear point (largest clearance from furniture and edges, inside the room), and determinism (two runs equal); verify they fail on today's placement where expected (`bun test src/render/walk-lighting/room-volumes.test.ts`).
- [ ] 1.2 Add `FurnitureBox` and `probeClearanceM: 0.5`; implement the clearance, the qualifying rule and the fallback in `probePoint`; update the existing footprint test to boxes; verify 1.1 and the whole file pass.
- [ ] 1.3 Red then green: `walk-lighting-wiring` fills `minY`/`maxY` from each furniture item's bounds; verify with its unit test (or a new one) that a known item's box carries its height.
- [ ] 1.4 Measure the placement time on the demo plan once (unit level) and record it for the report; verify the number is written down.

## 2. Placement refresh after furniture edits

- [ ] 2.1 Red: controller unit test: a debounced refresh hands the lighting the current document with the scope; verify it fails on the one-argument contract.
- [ ] 2.2 Change the handle contract to `refresh(scope, doc)` and pass `deps.document()`; verify 2.1 and the controller's other tests pass.
- [ ] 2.3 Red: component test in `tests/component/walk-lighting.test.ts`: in walk, move the living room's floor lamp to within 0.2 m of the probe point; after the debounce the capture is called at a point ≥ 0.5 m from the lamp's new box and every living-room box's `jeexProbe` equals it; an edit that moves no probe point re-captures only its room at the same point; verify it fails today.
- [ ] 2.4 Implement the refresh in `WalkLighting.refresh` (recompute, compare, write positions, `setRoomBoxes`, recapture scope ∪ moved; a box change reloads); update the «edit in walk» test's expectation to the new contract; verify 2.3 and the existing edit test pass on SwiftShader.

## 3. Gloss proof in the demo living room

- [ ] 3.1 Component test: demo living room in walk with the lighting live, the living probe point ≥ 0.5 m from the floor lamp box (the «Demo living room» scenario); verify it passes after group 1 (red on main: record the failing line).
- [ ] 3.2 Component test on the GPU: spec-only living floor (colour 0, maps off, metalness 0) at roughness 0.07 and 0.6 in a fixed pose, contrast p99/median of the floor mask; assert 0.07 ≥ 2.5 × 0.6; verify red before group 1 and green after, record both numbers and the renderer.
- [ ] 3.3 Component test on the GPU: a window-band pose (floor band where the living window's mirror image falls) at roughness 0.07; the band in the window's column is brighter than the floor beside it; verify red before group 1 and green after, record the numbers and before/after shots.

## 4. White balance

- [ ] 4.1 Red: `src/render/white-balance.test.ts`: identity at degree 0 and for a source equal to the display white; the source white maps to the display white at full degree and at the source's luminance; `y M = y` for any degree; the matrix equals an independently written reference computation for a fixed source and degree; verify it fails (no module).
- [ ] 4.2 Implement `src/render/white-balance.ts` (pure); verify 4.1 passes and the purity test still passes.
- [ ] 4.3 Red: `tests/component/walk-post.test.ts`: a flat patch of known linear colour through the chain with a non-identity matrix displays as the display transform of the matrix times the colour (1/255); the chain's passes and targets are unchanged; a missing shader anchor throws; verify it fails.
- [ ] 4.4 Implement `WalkOutputPass` and the `whiteBalance` option of `WalkPost` (default from the tuning, identity until calibrated); pass identity in the existing comparisons with the direct path; verify 4.3 and the whole walk-post file pass on SwiftShader.
- [ ] 4.5 Component test: in walk a probe captured with the matrix set equals one captured at identity; an orbit frame before and after walk stays pixel-identical; a still's neutral patch ratios match the screen's within 2 %; verify green.
- [ ] 4.6 Calibrate on the GPU at the demo walk start (design, decision 3): meter `source`, choose the degree for ceiling R/B 1.45, write both into `WALK_POST_TUNING.whiteBalance` with the measurement comment; verify the «Ceiling at the walk start» and «Coloured furniture and window» scenarios as a component test (red with the identity default, green after), record ceiling R/B and colour before/after.

## 5. Integration checks

- [ ] 5.1 No extra GPU cost: atlas `memoryBytes`, chain passes and targets unchanged against main; verify from the recorded stats.
- [ ] 5.2 Chrome and canvas e2e baselines of the editing modes pass unchanged on the GPU; walk baselines that change because of the white balance are listed, not re-shot.
- [ ] 5.3 `scripts/check.sh fast` green; tuning comments and any repository docs describing the walk probes and the walk output updated; verify by reading the diff.

## Workflow follow-up

- Independent review of these artifacts before implementation.
- Rebase onto the orbit-on-demand landing before the gate.
- Review of record, security review, one full gate through the machine's gate queue, owner approval, then archive the change.
