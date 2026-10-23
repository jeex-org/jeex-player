# Tasks

## 1. Pure foundations (TDD)

- [x] 1.1 `room-volumes.ts` test-first: rectilinear split, sampling/selection/projection boxes, interior probe point (L-shaped room), leaf-side ordering, 16-box limit; verify its unit test.
- [x] 1.2 `shell-origins.ts` test-first: shell meshes rebased (walls, skirtings, floors at +0.1 m, ceilings at −0.1 m, joints; interior parametric walls x/z only; opening frames in group frame; slab and ground untouched), world-space vertices and UVs unchanged; wired after the shell build and after `rebuildOpening` / `rebuildAll`; verify unit tests, a dollhouse full↔cutaway round trip, a `set_opening` rebuild, and that picking, export and sun-shadow tests stay green.
- [x] 1.3 `room-grid.ts` selection box test-first (unit; the exterior grid answers `true` everywhere) plus the analytic exterior grid's SH packing (unit: hemisphere reproduced exactly at sample normals; hemisphere + fill within the L2 error of a clamped cosine), grids parented in order.
- [x] 1.4 `box-probe-patch.ts` test-first: chunk-text test against r186 (incl. anisotropy and retroreflection branches kept), uniform states, tile-offset sampling math.
- [x] 1.5 `walk-rig.ts` test-first: editing/capture/walk states, exposure save/restore/re-apply after restore.

## 2. Bake, probes, controller

- [x] 2.1 `grid-bake.ts` test-first with stubs: grids in scene hidden, pass 0 then pass 1 visibility inside calls (exterior grid visible in pass 1), rig switched to the capture state around each slice and back after, exclusions restored in `finally` also on throw, probes-per-frame budget, order.
- [x] 2.2 `room-probes.ts` test-first with stubs: capture state, atlas tile layout, mirrors hidden, PMREM size check fails loudly.
- [x] 2.3 `walk-lighting-controller.ts` test-first with fakes: start after the chain is ready, direct look until swap, one-frame swap, restore on leaving, refresh scopes (furniture → probe, finish → grid+probe, opening → both rooms, load/rebuild/sun/restore → all), 16-box limit error, capture during bake uses the direct look, patch re-installed on new roots and materials.

## 3. Browser acceptance (heavy queue, new files in `COMPONENT_FILE_COST_S`)

- [ ] 3.1 Engine pins: selection box honoured (object outside the sampling box, inside the selection box takes that grid); patched shader with walk off equals the unpatched output; hidden grid not pushed.
- [ ] 3.2 Calibrate the ambient floor and walk exposure by measurement into the frozen tuning; verify «Windowless room darker», «No double counting», «Restore», «Facade», «Furniture by the wall».
- [ ] 3.3 Reflections: «Reflections line up with walls», «No seam at a doorway», «Bathroom reflects the bathroom», probes captured without feedback (a probe re-captured twice is identical).
- [ ] 3.4 Lifecycle: «No shader thrash», «Edit in walk», «Capture during the bake», «Panorama in walk», «Still in walk»; any new debug member as a two-file change.
- [ ] 3.5 Measure bake time (probes per frame, total frames) and memory on this desktop; report; phones are measured in the quality-tier step.

## 4. Docs, shots, integration

- [x] 4.1 README (what walk and tour add) and CHANGELOG.
- [ ] 4.2 Before/after shots from identical, logged poses: living room, bathroom, kitchen, a glossy floor, a doorway between a lit and a dark room.
- [ ] 4.3 Fast tier green, then the full gate once through the machine's gate queue on the final tree.
