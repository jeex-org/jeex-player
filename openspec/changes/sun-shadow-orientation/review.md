# Independent review

## Reviewer

An independent agent that did not write the artifacts, read-only, two rounds (round 1: 8 findings; round 2: 7 resolved, 1 partly).

## Findings

1. design.md / proposal.md / tasks 2.1: caching every rig from creation breaks external consumers of the lighting entry: fixed (opt-in `shadowCache` rig option, default false; test of an uncached consumer).
2. design.md / tasks 5.2: offscreen captures build their scene without the scene mount, so they would lack ceiling casters: fixed (shared `prepareSunShadow` used by the live mount and every offscreen build, with occlusion checked in a default-state still).
3. lighting-standard delta / tasks 1.3: fit ignored the effective, capability-clamped map size: fixed (map size is a fit input; the rig reports its effective size).
4. scene-site-orientation delta / tasks 3.1: nothing enforced «2.2 carries no `site`»: fixed (version-conditional rejection in the runtime validator and the JSON Schema, scenarios for 2.2 with `site` and malformed containers).
5. apartment-sun-shadow delta: exact frustum equality between capture and live view cannot hold when bounds differ: fixed (same orientation, casters and policy over each scene's own geometry).
6. design.md / tasks 5.x: dragging and animation had no way to supply bounds: fixed (`include(box)` grows the fit, `endPreview()` refits on commit, cancel, revert).
7. lighting-standard delta / tasks 1.3: camera basis, zenith and invalid input unspecified: fixed (up vector rule with the zenith case, full rejection list, real `DirectionalLight` projection test).
8. tasks.md: incomplete verification matrix: fixed (mutation matrix, mirror and export checks, adapter exception and recovery tests; after round 2 the live/capture cache-isolation test and heavy-queue routing of the default-still check added).

## Verdict

Ready for implementation: yes
