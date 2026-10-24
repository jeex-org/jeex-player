# Tasks

Every task starts with a test that fails for the right reason; the implementation follows. Browser tests run through the machine's heavy-work queue, affected files only, on SwiftShader and on the GPU, recording the renderer string.

## 1. Fixtures

- [ ] 1.1 Write `scripts/make-fixture-hdri.test.ts` (JPEG with `hdrgm` XMP and MPF, AVIF `ftyp`, sizes under 48 KB and 8 KB, sidecar JSON with sun facts and reference radiance samples) and see it fail on the missing files; verify with `bun test scripts/make-fixture-hdri.test.ts`
- [ ] 1.2 Write `scripts/make-fixture-hdri.ts` (procedural 1024×512 sky, sun spot at 54°/40°, red marker 90° clockwise, libultrahdr and ImageMagick paths as arguments, scan of the float data for the sidecar) and commit its outputs under `tests/fixtures/hdri/`; verify 1.1 passes and the script header documents how to re-run it

## 2. Host option

- [ ] 2.1 Write `src/app/hdri-option.schema.test.ts` for every rule of spec «HDRI option validation» (URL schemes, relative URL, finite angles, elevation bounds, colour normalisation, share in [0, 1), unknown keys, unknown preset) and see it fail; then add `src/app/hdri-option.schema.ts` (`zod/mini`); verify the test passes
- [ ] 2.2 Extend `src/app/viewer-options.test.ts`: default `{}`, an entry kept as given, one refused entry dropped with one `option-invalid` warning naming `lighting.hdri.<key>` while its sibling stays, no value from query or dataset; see it fail; then add the fold step and the `ViewerOptions` type; verify the tests pass and `viewer-options.schema.test.ts` agreement stays green
- [ ] 2.3 Regenerate the published options JSON Schema and document the option, the azimuth convention (`90 − a`), the active preset rule and the fallback in the README; verify `scripts/schema-gate.sh` and the README spelling check pass

## 3. Standard values and calibration math

- [ ] 3.1 Extend `src/lighting/lighting-standard.test.ts` for `LIGHTING_STANDARD.hdri` (four positive values, frozen, recipe values unchanged, version 1) and see it fail; add the values with provisional numbers from the research (loader compensation 1/0.95, sky brightness 3), finalised in task 9; verify the test passes and `scripts/lighting-entry-check.ts` stays green
- [ ] 3.2 Write `src/lighting/hdri-calibration.test.ts`: rotation formula (north 30, noon, stored 54 → 156°), storage conversion `90 − a`, irradiance integration on a uniform synthetic buffer (π·L horizontal within 1 %), cone residual, sun normal irradiance for share 0.5 at 30°, share-proportional intensity, refusal of share 1, luminance of the colour; see it fail; then write the pure module; verify the tests pass and `purity.test.ts` accepts it
- [ ] 3.3 Add a bun test that rotates the fixture's stored sun direction by the computed `rotationY` with three's `Euler` and compares with `sunDirection`'s azimuth; verify it passes

## 4. Probe atlas independent of the environment

- [ ] 4.1 Write a browser component test: room probes captured under a 256-cube environment raise no layout error and the reflected stripe matches the recipe reflection within 2 px; see it fail on today's layout check; then add `JEEX_PROBE_MAX_MIP`, bump the patch transform version, check captures against the atlas layout; verify it passes and the existing room-probe and box-probe tests stay green

## 5. Loading the pair

- [ ] 5.1 Write a browser component test of `loadHdriPair` on the fixtures: concurrent requests, half-float decode, PMREM cube 256, decoded source and generator disposed (renderer texture count), measurement equals the sidecar's within 2 %, abort disposes everything, a 404 on either file rejects and leaves no texture; see it fail; then write `src/render/hdri/hdri-assets.ts` and re-export it from `walk-post.ts`; verify it passes
- [ ] 5.2 Add the loader-compensation measurement to that test (decoded mean × `loaderCompensation` equals the sidecar's reference within 2 %); verify it passes with the measured value set in the standard

## 6. Scene state of an installed HDRI

- [ ] 6.1 Write a browser component test of `HdriSky`: `off → display → off` restores background, intensity, rotations, blurriness, environment, gain, fog, sun direction, colour, intensity, frustum and exterior grid texture exactly; `capture` uses the PMREM as background at the environment gain; `display` sets the sky at `skyBrightness / exposure`; fog off in `capture`, `display`, `sky-only`; see it fail; then write `src/render/hdri/hdri-sky.ts`; verify it passes
- [ ] 6.2 Extend `walk-rig.test.ts`: while the HDRI owns the background the rig neither divides nor restores it, and the gradient path is unchanged; see it fail; implement `ownsBackground`; verify it passes
- [ ] 6.3 Write the rotation sign rendering test (fixture, north 30, noon: spot centred within 3° along `W`, red marker on the clockwise side, mirror-like sphere's highlight facing `W`, a post's shadow along `W + 180°`) on both renderers; verify it passes
- [ ] 6.4 Write a browser test: with the HDRI in `display`, a grey card outside every room box is unchanged when the exterior grid's coefficients are doubled, and a mirror-like card outside the rooms reflects the spot; verify it passes

## 7. Hand-over, lifetime and diagnostics

- [ ] 7.1 Write unit tests of the active-preset pick (`src/app/hdri-wiring.test.ts`: site absent → none, site without sun → noon, missing entry → none, never another preset's entry); see them fail; then write `src/app/hdri-wiring.ts`; verify they pass
- [ ] 7.2 Extend `walk-lighting-controller.test.ts` with a fake loader: no load before the first eligible frame, one load for walk/tour switches, stale load disposed on arrival, preset change releases and reloads, failure logs one `hdri-unavailable` and is not retried until a new document, context loss disposes and the restore reloads, unmount releases; see them fail; implement `setHdri` in the controller; verify they pass
- [ ] 7.3 Extend `walk-lighting.test.ts`: installing a pair restarts the bake, `HdriSky` is `capture` inside slices and `off` between them, the swap frame moves it to `display` with the rig to `walk`, the `empty` phase shows `display` on the next eligible frame, each transition invalidates a draw; see them fail; implement; verify they pass and the no-recompile scenario of the swap still holds
- [ ] 7.4 Add `__viewerDebug.hdri()` with a test in `viewer-debug.test.ts` for every state; verify it passes
- [ ] 7.5 Write a browser component test of the viewer on the demo apartment with a site and on an empty-plan scene: nothing requested in orbit, both URLs on the first walk entry, the HDRI live after the swap, orbit pixel-identical after returning, no request on walk → tour → walk, the next tick draws when the pair arrives while resting; verify it passes on both renderers

## 8. Baked apartments

- [ ] 8.1 Write a browser component test with the debug light bake applied: only the sky URL requested, `sky-only` in the debug read, the baked floor reads as without the option within the walk tolerance, one `hdri-bake-daylight` warning per applied bake; see it fail; implement `loadHdriSky` and the `sky-only` path; verify it passes

## 9. Calibration on the real panoramas

- [ ] 9.1 Serve the three real pairs from outside the repository and measure, with a throwaway page or test kept outside the repository: `loaderCompensation` against the reference decode, `environmentGain` (open-air 0.18 card under HDRI vs recipe in walk within 5 %, analytic integration then metering), `skyBrightness` (median sky display value 0.8–0.95, under 25 % clipped) and each preset's sun intensity; set the values with their method in the comments; verify the tests of groups 3, 5 and 6 still pass with the final numbers

## 10. Budget, documentation and integration

- [ ] 10.1 Re-measure the walk chunk after `bun run build:lib` and the demo build, set `lazy-jeex-viewer-walk-post` to the new size plus 1 KB in `scripts/budget-check.ts` and its test with before/after in the comment; measure boot ES and IIFE before/after; verify `scripts/budget-check.test.ts` and the budget step pass and the lighting entry's limit is unchanged
- [ ] 10.2 Update the repository's architecture notes for the HDRI path (where the decoder lives, the `HdriSky` states, the background ownership rule, the atlas define) and add the user-facing CHANGELOG entry; verify the spelling and no-docs-refs checks pass
- [ ] 10.3 Run `scripts/check.sh fast` and the chrome and canvas end-to-end baselines unchanged on the GPU; verify both are green with no baseline re-shot

## Workflow follow-up

- Independent review of these artifacts (`review.md`) before implementation starts.
- Owner acceptance on the live viewer with the three real pairs; shots of walk in the demo apartment per preset.
- Archive the change after the project's review and gate requirements are satisfied.
