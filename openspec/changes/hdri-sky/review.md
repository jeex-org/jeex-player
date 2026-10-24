# Independent review

## Reviewer

An independent agent that did not write the artifacts read the change and the code it touches, read-only, in one round. The change's owner accepted every finding and the six choices the author listed (no `site` means no preset, share in [0, 1), one calibrated gain, exposure-compensated sky brightness, warn-level diagnostics, committed generated fixtures).

## Sol round

Verdict of the round: go with changes. Eight findings, all fixed in the artifacts:

1. High, design D7 and specs `hdri-sky`, `apartment-sun-shadow`: two writers of the sun's direction and frustum. A later `refit`, `include` or `settle` could put back a preset fit, and a saved snapshot could be restored over a newly aimed sun. **Fixed:** `SunShadow` is the only authority and gains `override(elevation | null)`. The azimuth always comes from the current site, so no snapshot is kept. The colour and intensity are restored in a fixed order. New scenario: a caster move and a north-only edit while live, then back to orbit (tasks 6.4, 7.5).
2. High, design D3 and spec `hdri-sky`: in an empty plan the rig stays `editing`, so the hemisphere and fill would add to the HDRI. **Fixed:** a rig flag `hdriDaylight` zeroes them from the rig's one saved map without touching the exposure. The empty-plan scenarios now meter geometry and check the restore (tasks 6.2, 7.5).
3. High, design D10 and spec `hdri-sky`: the bake passes through `waiting` and `loading`, so checking only `applied` let the environment load early. **Fixed:** a pending bake fetches the sky only, `applied` gives `sky-only`, and a dropped or refused bake releases the hold. New scenarios cover a late bake and a dropped bake (tasks 8.1, 8.2).
4. Medium, specs `hdri-sky` and `lighting-standard`, tasks 5.1–5.2: the threefold share scenario was wrong with a cone residual. **Fixed:** the threefold case is asserted only with zero residual, a residual case is added, `max(0, …)` is written into the requirement, and the 2 % agreement applies after loader compensation.
5. Medium, design D2 and D8: the bitmap orientation was unspecified, and a horizontal camera cannot centre a spot at 40°. **Fixed:** the sky is decoded with `imageOrientation: 'flipY'` and `colorSpaceConversion: 'none'`, and `close()` is called on release and on stale completion. The sign-test camera aims at `(W, 40°)`. Both renderers stay in the test.
6. Medium, design D2 and D11: three r186's loader takes no signal and throws its asynchronous decode error outside `load()`. **Fixed:** one small adapter fetches the bytes with the signal and decodes through `parse`. The loader instance's one error callback is pointed at the adapter's rejection, so every async error ends in one rejection, with no retry. A case for a corrupt embedded image is added (spec `hdri-sky`, task 5.1).
7. Medium, design D1: generating from the TypeScript type cannot carry the Zod refinements. **Fixed:** the generator gets annotations on `Hdri` and a post-processing step (`contains: { const: 1 }` and preset keys), `viewerOptionsSchema` is extended, and a runtime/JSON-Schema agreement test is added (task 2.3).
8. Medium, specs `apartment-sun-shadow`, `walk-room-lighting`, `hdri-sky`: the scope was too wide and the decoder rule conflicted with the IIFE build. **Fixed:** the HDRI sun, environment and exterior requirements now name the full-lighting states (`capture`, `display`) and exclude `ready`, `off` and `sky-only`. The decoder rule applies to the ES and demo boot graphs; the IIFE build carries the decoder inline.

## Findings

1. design/specs, single sun authority: fixed
2. design/specs, empty-plan lighting: fixed
3. design/specs, asynchronous bake states: fixed
4. specs/tasks, calibration assertions: fixed
5. design, bitmap orientation and sign-test camera: fixed
6. design/spec, decoder failure propagation: fixed
7. design, published JSON Schema constraints: fixed
8. specs, normative scope and IIFE: fixed

## Verdict

Ready for implementation: yes
