# Independent review

## Reviewer

An independent agent that did not write the artifacts, read-only, two rounds (round 1: 2 blockers, 7 should-fix; round 2: 7 resolved, 2 partly).

## Findings

1. design.md / tasks 1.2: inset previews render to the screen, so a null-target gate captured mirrors there too: fixed (scope set around every beauty render, match target, scene and camera; null-target preview regression).
2. design.md decision 6: the contract could not render a capture into the caller's target: fixed (`renderTo` writes the display-referred image into the caller's 8-bit target and restores size and target).
3. design.md / tasks 4.1: GTAO noise is random per pass, so separate capture chains break repeatable video; video frames call the still path directly: fixed (one chain instance for live and captures; video through the capture command; repeatability tests).
4. spec / design 7–8: captures during loading and partial or stale chains: fixed (captures await the chain, direct path on failure; round 2 leftover closed: stale completions and failed SMAA decodes dispose what they built).
5. proposal: the display-transform requirement of the lighting standard changes: fixed (lighting-standard delta; published entry unchanged).
6. tasks 3.2: sun-shadow behaviour under the chain unverified: fixed (settled draw counts under mutations; round 2 leftover closed: shadow-only casters invisible in processed mirror and still, capture leaves the live shadow cache untouched).
7. design.md decision 4: AO visibility rules imprecise: fixed (pure classifier by layer 0 and material properties, material arrays, restore on throw).
8. spec «Chain contents»: «renders the scene once» contradicted GTAO's input render; parameters only in the brainstorm: fixed.
9. tasks: verification gaps: fixed (classifier TDD, dispose spies, mirror brightness, video repeatability, panorama path, surface tests); the schema 2.2 compatibility check rejected: this change touches no schema.

## Verdict

Ready for implementation: yes
