# Brainstorm

## Problem

Lamps light the room in walk and tour only through their direct term: the grid bake hides the whole furniture root, so the lamp lights nested in furniture (fact lights and the built-in bank's bulbs) never reach the room light-probe grids, and a lamp-lit room gets no bounce. At the same time a shadowless point light reaches through walls up to its cutoff, so a lamp in one room lights the wall faces, floor and furniture of the room next door. Both must be fixed together, and the walk calibration measured again, because adding lamp bounce and removing the leak both move the readings the calibration was tuned on.

## Related work

- The lamp light fact, its point lights and `collectLampLights()` landed earlier (capability `player-lamp-lights`); this change builds on them and keeps that collector's contract.
- The walk gloss work (probe placement with 3D clearance, the walk white balance) and the host sky (HDRI) are on main; both are measured again here, not changed.
- No other branch in flight touches the walk lighting, the grid bake or the light order adapter.

## Doubts

1. Can the furniture bodies leave the grid capture without losing the lights nested under them? Three stops traversing at an invisible object, and a fact light is a child of the body, which may itself be a mesh.
2. Should shades stay visible to the grid capture, so a lamp's shade blocks part of its light?
3. Which display mechanism can restrict a light to one room in one pass: light layers, per-room passes, per-draw intensity changes, a per-object mask, or a per-light room lookup in the shader?
4. Does a lamp in room A switch off when the capture point or the camera is in room B? What about A's lamp-lit wall seen through a doorway?
5. Concave rooms: equality of rooms does not stop a light crossing the inner wall of an L-shaped room.
6. Double counting: the grid records lamp-lit surfaces; does direct lamp diffuse have to go?
7. Invalidation: a moved, removed or swapped lamp, and a temperature change, all change what the grids hold, while today's refresh only re-captures reflection probes.
8. Calibration: which readings move, which targets are frozen, and which knobs may be retuned.

## Approaches considered

1. **Grid capture: furniture meshes leave the capture by a temporary layer exclusion** (partner). A mesh failing the camera's layer test is not drawn, but three still traverses its children, so lights under it keep their world transforms, current tint and authored intensities, with no copies and no change in light count. Every original layer mask is restored after the slice. Hiding each mesh by `visible` would drop the lights under a mesh body, so it is rejected.
2. **Shades in or out of the diffuse grid** (both). A visible shade cannot shadow a shadowless point light; keeping furniture in the grid capture would only add furniture-dependent obstruction and probes inside furniture. Shades stay out of the grid capture. Reflection probes keep capturing furniture, with the existing emissive cap, so a glowing shade still shows in reflections. No second, emissive-based lamp model.
3. **Room scope in display** (partner table, author agreed):
   - stock light layers filter lights against the camera, not against meshes: rejected;
   - one render per room: extra submissions, depth and transparency trouble, more programs: deferred;
   - changing a light's intensity in a draw hook: three has already copied light uniforms before objects draw: rejected;
   - zero intensity when the camera leaves the room: switches off a visible lamp seen through a doorway and pops at the threshold: rejected;
   - a per-object mask: viable but needs reliable per-object uploads across shared materials and every capture;
   - **per-light source-room uniforms plus a receiver room lookup in the existing walk shader transform**: no room-specific program, no extra scene render: chosen.
4. **Source room by the emitter's world position against the room polygon** (partner), not the inset sampling box (which leaves out the wall margins). One stable room per lamp; ties resolved deterministically; a lamp in no room lights nothing in walk, never everything.
5. **Doorways** (partner). The gate is decided at the receiving surface: B's surfaces reject A's direct light, A's surfaces keep it, whatever room the capture point or the camera is in. A probe in B sees A's lamp-lit wall through the doorway, so bounce travels through openings while direct light stops at the room boundary.
6. **Concave rooms** (partner, author narrowed). A segment-containment test against the room's box union, only for multi-box rooms, would close the gap. It is added only if a supported scene (the demo apartment or a plan fixture) has a concave room with a lamp whose direct light visibly crosses an inner wall; otherwise the limit is written into the spec and deferred.
7. **Transport split** (partner). Direct lamp diffuse plus direct lamp specular plus grid bounce: a point light has no visible emitter in a capture, so the first grid pass records lamp-lit surfaces, not a second copy of the direct term. "Specular only" would drop legitimate direct diffuse; a near/far split needs a partitioned capture. The lightmap policy (a lamp marked baked adds no diffuse to a baked surface) is unchanged.
8. **Built-in bank lamps** (both). They get exactly the same inventory, room, gate and grid capture, keep their colours, intensities and cutoffs, and count against the same light budget. `collectLampLights()` keeps its fact-only contract; the runtime inventory is separate.
9. **Invalidation** (partner). A lamp-affecting change (move, removal, variant swap, temperature) reuses the full walk lighting restart: grids, then probes. A selective lamp-bounce dependency graph is deferred. Ordinary furniture keeps its selective probe refresh.
10. **Calibration** (partner). Measure before tuning, against frozen acceptance targets; daylight-only and lamps-on measured separately, each after a fresh bake (zeroing a lamp without a bake leaves its stored bounce behind).

## Decision

1. Grid capture: furniture meshes leave the capture by a temporary layer exclusion, ancestors stay visible, every original layer mask is restored in a `finally`. Shades stay out of the diffuse grid; reflection probes keep capturing furniture with the emissive cap.
2. Room gate:
   - each runtime lamp (every tagged artificial point light, fact or bank) gets one source room from its emitter's world position against the room polygon, ties resolved by the room order, and a lamp in no room lights nothing in walk;
   - a shared gate in the walk shader transform rejects a lamp's direct diffuse and specular where the receiving surface's room differs from the lamp's; rooms are uniforms, never defines or program keys;
   - the gate runs in display, in grid capture and in reflection capture, and it stays on during the walk warm-up;
   - every box of one room shares the room's index, so an artificial split makes no seam.
3. Concave rooms: room equality is the delivered rule; the segment test is added only on evidence from a supported scene, otherwise the limit is stated.
4. Transport: direct lamp diffuse + direct lamp specular + grid bounce; the lightmap policy is unchanged.
5. Bank lamps join the same scope and budget; `collectLampLights()` keeps its contract.
6. Invalidation: a lamp-affecting change restarts the whole walk lighting; ordinary furniture keeps its selective refresh.
7. Calibration: measure first; daylight-only and lamps-on separately after a fresh bake each; the windowless/window grey-card fixture stays a daylight control; the white balance may be recalibrated toward its existing warm-white band; exposure, ambient floor, sun factor, lamp units and the emissive cap stay unless an independent measurement justifies a change; gloss thresholds, poses and roughness never move to pass, and a physically justified conflict goes to an explicit acceptance decision.

## Rejected

- Hiding each furniture mesh by `visible`: a fact light under a mesh body would vanish with it.
- Furniture bodies or shades in the diffuse grid capture: no shadowing of a shadowless light, only obstruction and probes inside furniture.
- A second emissive-based lamp energy model: double counts the point light.
- Stock light layers: they filter against the camera, not the receiving mesh.
- One render per room: extra passes and programs; deferred.
- Changing light intensity in a draw hook: light uniforms are set before objects draw.
- Switching foreign lamps off by camera or capture-point room: a lamp seen through a doorway goes dark and the threshold pops.
- Specular-only direct lamps, or a near/far split: drops real diffuse, or needs a partitioned capture.
- Setting the bake mark because a lamp now feeds the grid: the grid is not a lightmap.
- Reusing `collectLampLights()` as the runtime inventory: it is fact-only by contract and feeds the lightmap bake.
- A selective lamp-bounce dependency graph: the full restart is correct and small.

## Open questions

None for the owner. Whether a supported scene has a concave room with a leaking lamp is measured in the tasks; the decision rule for both outcomes is fixed above.

## Process

One read-only consult round with an independent partner agent, which read the code itself; its proposals were merged with the author's draft and its file references checked against the code. No measurement was taken in the consult: every number in the design comes from the tasks.
