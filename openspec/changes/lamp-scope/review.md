# Independent review

## Reviewer

An independent partner agent that did not write the artifacts, one read-only round. Its text follows verbatim.

## Review text

**Verdict: go with changes.**

Static artifact review against the binding decisions and earlier consult. No files changed, tests run, or GPU measurements taken. The filesystem is read-only, so this is the report intended for `sol-lampscope-review.md`.

The ADDED/MODIFIED split is correct: the new lamp requirements are ADDED; existing refresh, light-order, warm-up and README requirements are MODIFIED with their previous scenarios retained. The overall transport model, bank-lamp inclusion and shared receiver gate match the decisions. The following changes are needed.

1. **[P1] The signature check can miss lamp removal entirely.**  
   Anchor: [design.md:76](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/design.md:76).

   Comparing signatures inside `refresh()` works only when something calls it. The current wiring looks up touched assets in the **updated** model; a removed asset has no room. `refreshScope()` then returns null when no other affected room remains, so no refresh reaches the signature check. Moving a lamp outside all room polygons has the same problem.

   The design must ensure these asset changes reach lamp invalidation even without a current room lookup. Extend task 5.1 through the real removal and movement commands, including removing the last lamp and moving it outside all rooms. Calling `refresh()` directly would conceal this gap.

2. **[P2] Receiver boxes have margins, but exact opening boundaries remain unresolved.**  
   Anchors: [design.md:58](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/design.md:58), [design.md:121](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/design.md:121).

   The lookup uses **selection boxes**, not inset sampling boxes. Existing selection boxes grow to wall centrelines and extend 0.2 m below the floor and above the ceiling; the lookup also pushes 0.05 m along the normal. Ordinary inward wall faces, floors, ceilings, skirting and furniture against walls should therefore retain their own room’s light.

   That does not settle opening geometry. The current containment predicate is strict `> 0`. A jamb or reveal exactly on the shared centreline, with a normal parallel to that boundary, remains on the boundary after the push and belongs to neither room. Deeper reveals can also remain outside the selection volume. “Push into the room it faces” is consequently not a complete rule.

   Specify boundary inclusion, deterministic ownership and the intended treatment of both sides of door leaves and frames. Add rendered assertions for those parts, window reveals and wall-adjacent furniture in display and captures; the doorway screenshot alone is insufficient. Avoid widening boxes indiscriminately across walls.

3. **[P2] Strict polygon assignment disables an emitter embedded in wall thickness.**  
   Anchors: [design.md:41](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/design.md:41), [walk-room-lighting/spec.md:45](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/specs/walk-room-lighting/spec.md:45).

   An emitter even slightly outside the room polygon, beyond the 1e-6 m tolerance, receives the unassigned sentinel and contributes neither direct light nor captured lamp bounce. The sconce scenario tests an emitter **inside** the polygon, so it does not cover the stated concern.

   This follows the binding decision exactly; it is a product-contract issue to resolve explicitly. Check supported wall-mounted facts. Correct an unintentionally embedded emitter, or amend the decision with a bounded, mounting-side assignment rule for intentional cases. A general nearest-room fallback would undermine isolation.

4. **[P2] Retained visibility exclusions can still swallow nested lamp lights.**  
   Anchor: [design.md:29](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/design.md:29).

   A furniture mesh with transmission still enters the existing `visible = false` exclusion list. If its PointLight is a child, traversal stops there despite the new layer mask. That contradicts the promised support for lights nested under mesh bodies.

   Furniture renderables should consistently use the layer exclusion. Retain other exclusions without hiding a lamp’s ancestor. Extend the existing nested-body case with a transmissive body; no separate lighting mechanism is needed.

5. **[P2] Several planned pixel comparisons conflate direct light with legitimate bounce.**  
   Anchors: [tasks.md:8](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/tasks.md:8), [walk-room-lighting/spec.md:55](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/specs/walk-room-lighting/spec.md:55), [tasks.md:33](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/tasks.md:33).

   Geometry cannot shield the shadowless PointLight in task 1.2. Put the card beyond the cutoff while leaving lamp-lit shell visible to its grid.

   Likewise, a far-side card need not have identical **total** readings after fresh lamp-on/off bakes when the fixture has a doorway elsewhere: valid bounce may reach it. After moving the lamp, its old room may receive new doorway bounce. Isolate direct-light rejection, and test removal of stale stored light separately.

   The camera-independence scenario also needs a zero-specular diffuse receiver or another controlled comparison: direct specular legitimately changes with viewing direction. Record masks, measurement domains and numerical tolerances so each scenario has a reproducible oracle.

6. **[P2] Calibration needs an explicit decomposition and clearer target applicability.**  
   Anchors: [design.md:95](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/design.md:95), [design.md:97](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/design.md:97), [design.md:105](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/design.md:105).

   “Lamps-on minus daylight-only, with the grid frozen and direct gated” does not define three independent readings. A shared frozen grid cancels its bounce contribution; separate fresh grids with direct suppressed isolate bounce only.

   Specify a linear, zero-specular-card procedure: capture a fresh lamp-off baseline; bake lamps on and read with direct suppressed; retain that grid and read with direct enabled. Those differences provide bounce, direct and combined contributions.

   The acceptance numbers match the consult: daylight ratios, default warm-white band, shade bounds, gloss thresholds and sunlit-floor bounds should remain. However, `2.086` is a historical **default-state measurement**, not a physical target for both daylight-only and lamps-on columns. Update that recorded baseline with evidence independently of whether white balance needs retuning. Label which table cells are acceptance checks and which are diagnostic readings.

   Also replace “independent daylight measurement” with evidence appropriate to the parameter: shade measurements justify an emissive-cap decision. The binding decision permits an independent measurement, without requiring daylight evidence for every parameter.

7. **[P2] A temperature restart is justified, but its cost and cross-mode lifecycle remain unproved.**  
   Anchors: [design.md:77](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/design.md:77), [design.md:117](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/design.md:117).

   Once grids contain tinted lamp bounce, reflection-only refresh is incorrect. The full grids-then-probes restart is the approved small implementation.

   Temperature changes are not confined to walk: host commands, attributes and the panel tint artificial lights in editing modes too. Heavy refresh should remain deferred until walk/tour, whose entry must use the latest tint. Cover editing-temperature-change → entry, and a change during the initial bake; avoid repeating work already baked at that temperature.

   With `N` grid locations and `R` rooms, the current schedule performs two grid passes—approximately `ceil(2N/6)` slices—then `R` reflection captures. The grid passes alone entail `12N` scene-face renders, plus projection/repacking work. Entry retains that schedule but adds lamp lighting and gate work to captures; a settled temperature change repeats it.

   `bakeMs` and `probeMs` do not establish user-visible waiting time or GPU completion. Report wall-clock time to `live`, cold versus warm entry, temperature-settle-to-live time and worst slice duration alongside the planned counters. No “cheap enough” conclusion is supported yet; numerical tier budgeting remains step 7.

8. **[P2] The shader plan is sound; extend count-change verification.**  
   Anchors: [design.md:50](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/design.md:50), [design.md:68](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/design.md:68), [baked-surface/spec.md:31](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/specs/baked-surface/spec.md:31).

   Float room indices and the `-1`/`-2` sentinels are suitable ordinary uniforms. Guarding the array at zero lights avoids a zero-length declaration. The installed three shader processor substitutes the light count and unrolls `[i]`, so the proposed gate placement works before direct BRDF evaluation.

   Filling room indices beside the existing point masks correctly follows three’s traversal, camera-layer filtering and stable shadow/map sorting. Uniform room changes need no program variants; actual light-count or shadow-layout changes may select new programs.

   Extend the existing lifecycle test through zero → one → several → zero lights, checking pixels and WebGL errors. Ensure each render uploads the current array length/order, including nested-camera return. Keep constant-program assertions restricted to unchanged light configuration. The unconditional capture/display count claim at design line 31 needs that qualification.

9. **[P2] Keep the conditional concave-room scope, but remove the unproved sampled guarantee.**  
   Anchors: [design.md:86](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/design.md:86), [walk-room-lighting/spec.md:83](/home/techmeat/projects/jeex/jeex-player-light-lampscope/openspec/changes/lamp-scope/specs/walk-room-lighting/spec.md:83).

   Auditing supported scenes before adding segment containment correctly follows the narrowed binding decision. Fixed-count sampling is not inherently conservative: a segment can leave and re-enter the permitted union between samples.

   Remove that algorithmic promise until the supported-case trigger is established. If triggered, require a demonstrated containment method and measured cost. Make the delta’s condition explicit: a demonstrated supported leak requires the fix; otherwise documenting the limit is permitted. The present unconditional “README or test” scenario can pass without enforcing that distinction.

   Continue deferring shadows, emitter slots, selective lamp-bounce tracking, multipass rooms and quality tiers. None is needed to resolve these findings.
## Findings

1. design, tasks: lamp removal or a move out of every room never reaches the signature check: fixed (scope flag `lamps` set by every asset edit; tests through the real move and remove commands, the last lamp included).
2. design, spec: receiver boundary and opening parts unresolved: fixed (`≥ 0` inclusion, owner the room the normal points into, lower index on a tie, each side of a leaf or frame takes the room it faces, rendered jamb/leaf/reveal/furniture assertions in display and capture, no widened boxes).
3. design, spec: an emitter in the wall thickness lights nothing: fixed (audit of supported wall-mounted facts first, wrong facts corrected at their source, no nearest-room fallback, a mounting-side rule only on an agreed intentional case).
4. design, tasks: transmissive furniture still hidden by visibility: fixed (every furniture renderable by layer exclusion, transmissive nested-body test).
5. spec, tasks: oracles mixed direct and bounce: fixed (card beyond the cutoff, direct rejection with a kept grid, stale light tested on its own, zero-specular card for camera independence, masks, domains and tolerances recorded).
6. design: calibration decomposition and target kinds: fixed (three readings A/B/C, 2.086 re-recorded as a default-state baseline, cells marked acceptance or diagnostic, evidence fitting each parameter).
7. design, spec, tasks: temperature lifecycle and cost: fixed (no heavy refresh outside walk and tour, entry hands a pending relight over at once, change during the initial bake restarts, unchanged temperature re-bakes nothing, wall-clock timings reported without a cost claim).
8. design, spec, tasks: light-count lifecycle and program claims: fixed (none → one → several → none with pixels and WebGL errors, constant-program claims limited to an unchanged light configuration).
9. design, spec: sampled-segment promise: fixed (dropped; a demonstrated supported leak requires a demonstrated method with measured cost, otherwise the limit is documented).

## Verdict

Ready for implementation: yes
