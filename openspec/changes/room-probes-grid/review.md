# Independent review

## Reviewer

Sol unavailable until 14:39, Opus rounds: two independent agents that did not write the artifacts, read-only; round 1: 2 blockers, 10 should-fix or nit; round 2: 10 resolved, 1 partly, 1 new blocker, 3 notes.

## Findings

1. design / brainstorm: grids baked outside the scene get no bounce: fixed (grids in the scene, hidden; visible only inside bake calls and at the swap).
2. design: `compile` never pushes grids: fixed (probe captures with grids visible warm the programs; a 1×1 render covers the exterior).
3. design: furniture, wall-snapped assets, door leaves, window parts and opening frames outside inset boxes; shared asset geometry: fixed (selection box via a `Box3` subclass; shell-only rebase; grid order by parenting).
4. design: the patch on materials created later: fixed (traversal on every trigger and new root or material, `needsUpdate` on compiled ones).
5. probe capture rig state: fixed (three states via shared uniforms; switched around every bake slice).
6. exposure: fixed (`toneMappingExposure`, applied at the swap).
7. baked catch-all too costly: fixed (analytic exterior grid).
8. spec gaps: fixed (doorway seam, outside-room reflections, 16-box limit, capture during bake, panorama, probes-per-frame budget, load and rebuild in walk; phones deferred to the quality-tier step).
9. refresh scopes: fixed.
10. task gaps: fixed.
11. atlas sampling: fixed.
12. concave rooms: grids as well as probes approximate a concave room: accepted and stated in the design and the spec (splitting floors, ceilings and crossing wall faces per sub-box is a later refinement).
13. new (round 2): facade parity impossible with a hemisphere-only exterior grid: fixed (environment diffuse kept outside room boxes, exterior grid holds hemisphere + fill as L2 SH).
14. notes (round 2): exterior grid selects every point; multi-scattering takes the grid irradiance; exterior grid visible in pass 1 and capture: all taken.

## Verdict

Ready for implementation: yes
