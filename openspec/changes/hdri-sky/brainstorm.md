# Brainstorm

## Problem

Walk and tour show a two-colour gradient sky through the windows and light the apartment from a neutral studio environment, a hemisphere light and an artistic sun. A host that has a real sky panorama for the scene's time of day cannot use it: the windows do not show it, the exterior and the room probes do not see it, and the sun does not agree with it. The change lets a host hand the viewer one high-dynamic-range environment and one display sky per sun preset, and makes walk and tour show that sky and light the apartment from it, consistently, without costing anything at boot or in the editing modes.

## Related work

1. The walk room lighting (room grids, the exterior grid, room probes, the walk rig) and the walk post-processing chain already exist and are loaded lazily in one chunk; this change rides on both.
2. A parallel change makes orbit draw on demand; it touches the render-demand module, the viewer stage and their test. This change touches them only to invalidate a draw when an HDRI is installed or released, and lands after it.
3. Baked apartments (an offline lightmap applied to the shell) record the daylight of the recipe; a later bake delivery will make baking consume the same HDRI inputs. Here a baked apartment only gains the visible sky.
4. The scene's `site` (north angle and sun preset) and its editing operation exist; a scene reference to a library sky record does not exist yet and is not added here.

## Doubts

1. Contract placement: a scene field or a host option; how the sun facts travel with the images.
2. Sign and handedness of the rotation that brings the panorama's sun to the preset's azimuth.
3. Whether captures for the room grids and probes should see the display sky or the high-dynamic-range one.
4. The probe atlas samples with constants three derives from `scene.environment`'s size; a 1K panorama gives a 256 cube where the recipe gave 128.
5. Double counting outside the rooms: the exterior grid carries the recipe's hemisphere and fill, while the panorama's diffuse lights the same fragments.
6. The walk rig divides the background intensity by the walk exposure on entry and restores it on exit, which would cancel or overwrite any sky brightness set elsewhere.
7. The gradient fog colours geometry towards the gradient's colour and would disagree with a panorama.
8. Absolute brightness: a gain-map image clamps the sun; the analytic sun has to carry it; the shipped decoder returns the image about 5 % darker than the reference decoder.
9. Baked apartments: their lightmaps record recipe daylight; changing the sun's direction, colour or strength under them breaks the balance between baked indirect and live direct light.
10. Lifetimes: stale loads after a preset change, context loss, unmount, repeated walk/tour switches, a failed fetch.
11. Bundle cost: the gain-map decoder must not reach the boot bundle or the published lighting entry.

## Approaches considered

1. **Scene field referencing a sky record** (author): `site.sky` names a library record that resolves to the image pair. Evidence: the scene schema has no library of skies and no resolver for one; the library's identity, licence and storage are not designed. Cost: a schema version, a resolver, an editing operation. Risk: designs the library inside the player.
2. **Host option carrying the resolved pair and its sun facts** (author and partner): `lighting.hdri` per sun preset, holding two URLs and the sun's stored azimuth, elevation, linear colour and share of horizontal irradiance, validated at option resolution. Evidence: `viewer-options.ts` already resolves typed host objects at mount; the sun facts are measured once at import by whoever owns the library. Cost: one option, one schema. A later scene reference can resolve into the same contract.
3. **High-dynamic-range sky as the visible background** (author): show the decoded gain-map panorama itself through the windows. Evidence from measurement: a 2K gain-map image costs about 456 KB and about 130 ms of main-thread decoding, against a 2K AVIF of about 250 KB decoded off the main thread; the window is overexposed anyway. Rejected in favour of a display AVIF.
4. **Rotate only, keep the preset's elevation** (author): rotate the panorama so its sun's azimuth matches the preset and keep the preset's 20°/55° elevation. Partner's evidence: the measured panoramas have their suns at 8°, 43° and 10.5°; no Y rotation reconciles elevations, so the analytic sun takes the stored elevation in HDRI states.
5. **Captures see the display sky** (author's first reading) vs **captures see the high-dynamic-range environment as background** (partner): the display AVIF carries an artistic brightness for the window; grids and probes would record that brightness as light. The partner's version keeps the capture input physically consistent with the environment.
6. **Per-image brightness normalisation at load** vs **one calibrated gain plus a sun derived from measured sky irradiance** (both): normalising every panorama to the same irradiance would erase the difference between a morning and a noon sky and cancel the loader's darkening silently; one gain from the lighting standard keeps the presets' relative brightness and puts the loader's factor where a three upgrade will find it.

## Decision

Approach 2 with the partner's corrections:

1. A typed host option `lighting.hdri`, a partial record keyed by sun preset; each entry carries an environment URL (1K gain-map JPEG), a sky URL (display AVIF) and the sun's stored azimuth (clockwise from +Z towards +X in the panorama's own frame), elevation, linear colour and share of horizontal irradiance. Validated with Zod at option resolution; an invalid entry is dropped with the usual option warning. A preset without an entry uses the recipe; no entry is ever borrowed by another preset. No query parameter, no attribute, no scene field, no ids minted by the viewer.
2. The decoder and all wiring live in the lazy walk chunk. The active preset's pair is fetched concurrently on the first walk or tour entry; the gradient and recipe stay until both are ready; one prefiltered environment per HDRI; decoded sources and the generator are disposed after conversion; the installation goes live together with the room lighting's next swap so sky, sun and rooms agree.
3. In walk and tour (display and capture states) the environment is the HDRI; room probes still win inside rooms; the exterior grid's recipe light is zeroed; captures use the high-dynamic-range environment as background at the lighting gain; the probe atlas's sampling constants no longer follow the environment's size.
4. The analytic sun takes the preset azimuth plus north, the stored elevation and colour, and an intensity derived from the measured sky irradiance and the stored share, under one calibrated environment gain and a loader compensation published by the lighting standard. The recipe calibration and the appearance version do not change.
5. One rotation `radians(northDeg + presetAzimuth − storedAzimuth)` for background and environment, pinned by a rendering test.
6. The sky's brightness has one owner while it is shown; the gradient fog is off while the panorama is shown and restored otherwise.
7. Baked apartments gain the visible sky only and report once that the HDRI lighting is not applied to their bake.
8. Fixtures are synthetic, small and committed with their generator.

## Rejected

1. Scene field now: the library it would reference is not designed; the option is the contract the later reference resolves into.
2. Query parameter or attribute transport: the entry is a structured object; strings would need a second parser and a second validation surface.
3. Gain-map image as the visible sky: twice the bytes and main-thread decoding for a window that is overexposed by design.
4. Radiance `.hdr` files: thirteen times the bytes and a half-float path that already clips the sun.
5. Rotation only: cannot reconcile measured sun elevations with the presets.
6. Display sky in captures: records an artistic brightness as light.
7. Per-image normalisation: erases the presets' relative brightness and hides the decoder's error.
8. HDRI lighting under an existing bake: the bake recorded recipe daylight; mixing breaks direct/indirect balance until baking consumes the same inputs.
9. Prefetch of all presets, a multi-preset GPU cache, worker or GPU decoding: no measured need yet.

## Open questions

None that change the product or the task breakdown. Two choices made here for the reviewer to confirm: a scene without `site` has no sun preset, so it shows the recipe whatever the option holds; a failed pair is not retried until the next mount or the next document.

## Process

Partner: an independent model read the code read-only and answered one round on the contract, load path, lighting, baked apartments, rotation, fixtures and budget; its answers are merged above. The decisions were then confirmed by the change's owner. No disagreement needed a second round.
