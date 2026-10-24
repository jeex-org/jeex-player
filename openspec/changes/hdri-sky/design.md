# Design

## Context

See proposal.md (Why) and brainstorm.md (Decision). The code this design builds on:

1. `src/app/viewer-options.ts` folds `OPTION_SCHEMA` rows (string-transportable kinds) and copies `OPAQUE_PATHS` through; there is no validated object option yet. Validation uses `zod/mini` from `*.schema.ts` modules only.
2. The walk chunk: `src/app/walk-post-controller.ts` imports `src/render/walk-post.ts` on the first walk/tour frame; `walk-post.ts` re-exports `WalkLighting`. `src/app/walk-lighting-controller.ts` builds it on the first eligible frame and calls `frame(eligible)` every frame.
3. `WalkLighting` (`src/render/walk-lighting/walk-lighting.ts`) phases `baking → probes → live`, or `empty` when the plan has no closed room; the swap frame shows every grid and moves the rig to `walk`. Between bake slices the rig is in `editing`; inside a slice in `capture`.
4. `WalkRig` (`walk-rig.ts`) zeroes the hemisphere and fill in `capture`/`walk`, sets the walk exposure and divides `scene.backgroundIntensity` by it in `walk`, restoring both on `editing`.
5. The exterior grid (`room-grid.ts` `createExteriorGrid`) packs the recipe hemisphere and fill as L2 SH into a fixed 2×2×2 `LightProbeGridWebGL`.
6. The box-probe patch samples the probe atlas with three's `CUBEUV_MAX_MIP`, a define three derives from `scene.environment`'s height; `RoomProbes` refuses a capture whose layout height differs from `scene.environment.image.height`. The recipe environment (512×256) gives a 128 cube, equal to the atlas's; a 1K HDRI gives 256.
7. `render-runtime.ts` installs a gradient `scene.background` and a linear `THREE.Fog` once; `capture-commands.ts` copies the fog into capture scenes.
8. The lighting context saves the scene's environment, gain and rotation on attach and restores them on detach only if its own environment is still on the scene.
9. `sunDirection` (`src/lighting/sun-direction.ts`): world azimuth `W = northDeg + preset.azimuth`, clockwise from +Z towards +X; three's equirect azimuth is `atan2(z, x) = 90° − W`.
10. A light bake applied by `light-bake-wiring.ts` marks baked surfaces; its state is readable through the debug surface (`lightBake()`).
11. The logger knows `warn` and `error` only; diagnostics beyond the log go through `__viewerDebug`.

## Goals / Non-Goals

**Goals:**

1. One validated host contract that a later scene reference resolves into unchanged.
2. Every byte of decoder and HDRI logic in the walk chunk; boot gains the schema and a few lines of wiring.
3. Sky, environment, sun and room lighting agree in the first HDRI frame.
4. The editing modes and the no-option path are pixel-identical to today.

**Non-Goals:**

1. Scene references, library records, attribution UI, iframe or attribute transport.
2. 4K skies, prefetch, worker or GPU decoding, a multi-preset cache.
3. HDRI-consistent baking.
4. Any change of the recipe calibration or `LIGHTING_STANDARD_VERSION`.

## Decisions

### D1. Contract and validation

`ViewerOptions.lighting.hdri: Partial<Record<SunPresetName, Hdri>>`, default `{}`.

```ts
type Hdri = {
  environmentUrl: string; // 1K gain-map JPEG (Ultra HDR)
  skyUrl: string;         // display sky, AVIF (any format the browser decodes)
  sun: {
    azimuthDeg: number;   // panorama frame, clockwise from +Z towards +X
    elevationDeg: number; // (0, 90]
    colourLinear: readonly [number, number, number]; // max channel 1
    horizontalIrradianceShare: number;               // [0, 1)
  };
};
```

1. The schema lives in `src/app/hdri-option.schema.ts` (`zod/mini`, strict objects; URL rule: `new URL(value)` succeeds and the protocol is `http:`, `https:` or `blob:`; the protocol check is a refinement, not `z.url()`, so `blob:` passes). It is NOT exported from the lighting entry, which keeps its size and its no-three/no-DOM gate.
2. `resolveViewerOptions` gets one more fold step after `OPTION_SCHEMA` and before `OPAQUE_PATHS`: `lighting.hdri` is read with `given`, each own key is judged separately, refused keys log `option-invalid` with the path `lighting.hdri.<key>` through the existing sink, kept entries are frozen copies. Not an `OPTION_SCHEMA` row (no kind is string-transportable for it), so `optionsFromQuery`/`optionsFromDataset` never produce it.
3. Library storage of the research's `atan2(z, x)` azimuth `a` converts as `azimuthDeg = 90 − a` (wrapped to [0, 360)); the conversion is the host's, stated in the README with the example `a = 36 → 54`.
4. `share = 1` is refused because the calibration divides by `1 − share`; this narrows the owner's `[0, 1]` by its one degenerate value.
5. The published viewer options JSON Schema is generated from the TypeScript type, so the constraints are written as generator annotations on `Hdri` (`@pattern ^(https?|blob):` on both URLs, `@exclusiveMinimum 0` / `@maximum 90` on elevation, `@minimum 0` / `@exclusiveMaximum 1` on share, three items in [0, 1] on the colour) plus one post-processing step in `scripts/schema-gen.ts` that adds `contains: { const: 1 }` to the colour (the largest channel is 1) and restricts `lighting.hdri`'s keys to the presets. `viewerOptionsSchema` (`viewer-options.schema.ts`) is extended with the new entry schema, and an agreement test runs representative entries (valid, relative URL, `ftp:` URL, elevation 0, share 1, colour `[2, 1, 0.5]`, colour `[0.5, 0.5, 0.5]`, unknown preset) through both the runtime schema and the published JSON Schema and expects the same verdicts. The README documents the option, the azimuth convention and the fallback.

Alternative: an `OPTION_SCHEMA` kind `object`. Rejected: every row is shaped for query/attribute strings.

### D2. Module layout and load path

1. `src/render/hdri/hdri-assets.ts` (walk chunk): `loadHdriEnvironment(renderer, entry, signal)` and `loadHdriSky(entry, signal)` are separate loads (a pending light bake needs the sky alone); the walk lighting controller starts both at once and releases one when the other fails (D11).
   - Environment, one small adapter of ours: `fetch(url, { signal })` → `arrayBuffer()` → `UltraHDRLoader.parse(buffer, onLoad)` (half float) inside a promise. Synchronous throws of `parse` reject it; three r186 throws the asynchronous bitmap-decode error from inside its own `.catch` (it never reaches the caller), so the adapter replaces that one error callback on its loader instance (`_applyGainmapToSDR`, called with our `reject`) and the result is a `DataTexture` built the way `load()` builds it (`flipY`, linear sRGB, half float). The private hook is pinned to r186 and re-checked on every three upgrade, like `light-order.ts`. The signal is checked after the fetch and after the decode; an abort after decode disposes. No retry.
   - Sky: `fetch(url, { signal })` → `blob()` → `createImageBitmap(blob, { imageOrientation: 'flipY', colorSpaceConversion: 'none' })` (three ignores `Texture.flipY` for an `ImageBitmap`), wrapped in a `Texture` with `SRGBColorSpace`, `EquirectangularReflectionMapping`, mipmaps on. The bitmap is closed (`ImageBitmap.close()`) on release and on a stale or aborted completion.
   - Each load rejects once on failure; whatever it made is disposed before the rejection.
   - After the environment decodes: measure irradiance (D6) from its texels, `PMREMGenerator.fromEquirectangular`, dispose the decoded texture and the generator. Returns `{ pmrem, sky, cubeSize, measurement }` with one `dispose()`.
2. `src/render/hdri/hdri-sky.ts` (walk chunk): `HdriSky`, the scene state of an installed pair: `apply('off' | 'capture' | 'display' | 'sky-only')` saves on the first departure from `off` and restores exactly on return (background, its intensity, rotation and blurriness, environment, its gain and rotation, fog, sun direction, colour, intensity and frustum, the exterior grid's texture).
3. Pure math in `src/lighting/hdri-calibration.ts` (pure, no three): rotation, sun angles, irradiance integration over a texel buffer, sun intensity. Imported by the walk chunk only; not exported from the lighting entry's index, so the entry's size gate sees none of it. The standard's values (D6) are data in `lighting-standard.ts`.
4. `walk-post.ts` re-exports `loadHdriEnvironment`, `loadHdriSky` and `HdriSky` beside `WalkLighting`; the dynamic import that already exists brings them.
5. App side (boot bundle, wiring only): `src/app/hdri-wiring.ts` picks the active entry from the resolved options and the mounted document's `site` (D3) and hands it to the walk lighting controller with `setHdri(entry | null)`. The controller starts the load on the first eligible frame after the chain and the lighting exist, with an `AbortSignal` tied to the entry, the context and the viewer.

### D3. Active preset and hand-over

1. Active preset: `site === undefined ? null : site.sun ?? 'noon'`; entry = `options.lighting.hdri[preset] ?? null`. Recomputed on every `setDocument` and after a `site` operation (the existing commit path), not per frame.
2. States of `HdriSky`, decided by `WalkLighting` each frame:
   - `off`: not eligible (editing modes), or no pair yet (`loading`), or the pair installed but the swap not reached (`ready`).
   - `capture`: the rig is in `capture` and a pair is installed (inside bake slices). Full lighting.
   - `display`: eligible and the pair installed and (`phase === 'live'` or `phase === 'empty'`). Full lighting.
   - `sky-only`: eligible, a light bake is applied and the sky is ready (D10). Sky and fog only.
   The HDRI environment, sun and exterior grid change only in the two full-lighting states.
3. Empty plan: the rig stays in `editing` (no walk exposure, no ambient floor), but the hemisphere and fill must not add to the HDRI. The walk rig stays their single owner: a rig flag `hdriDaylight` makes `reapply` zero them from its one saved map in `editing` too, and clearing the flag restores them. `WalkLighting` sets the flag while `HdriSky` is in a full-lighting state and clears it otherwise. The renderer exposure is untouched.
4. When a pair finishes loading, `WalkLighting.setHdri(pair)` installs it and calls `restart()`: grids and probes are captured with `HdriSky` in `capture`, the screen keeps the current look in between, and the swap frame moves `HdriSky` to `display` with the rig to `walk`, so sky, sun and room lighting change in one frame. In `empty` the next eligible frame shows `display`.
5. Each transition invalidates a draw through `runtime.demand.invalidate()` (walk on-demand rule). Only this call is added to the sibling change's files.

### D4. Capture background

In `capture` the scene background is the HDRI's PMREM texture (`CubeUVReflectionMapping`, which three draws from mip 0), `backgroundIntensity` = the environment gain, `backgroundRotation` = the rotation, `backgroundBlurriness` 0. Room probes are already excluded from captures (`RoomProbes` turns the box probes off), so no capture sees a probe.

### D5. Probe atlas decoupled from the environment

1. The patch's `jeexBilinear`/`jeexProbeSample` use a define `JEEX_PROBE_MAX_MIP` (log2 of the atlas cube size, 7 for 128) instead of `CUBEUV_MAX_MIP`; `cubeUV_minMipLevel`, `cubeUV_m0`, `roughnessToMip` are three's size-independent constants and stay. Transform version bumped.
2. `RoomProbes` checks each capture against the atlas layout's own height constant, not `scene.environment.image.height`; the `expectedHeight` dependency is removed from `WalkLighting.restart`.
3. Test: room probes under a 256-cube environment produce the same reflected stripe as under the recipe within 2 px (spec `walk-room-lighting`).

### D6. Exterior grid and calibration

1. Exterior grid: in `capture` and `display`, `HdriSky` swaps the exterior grid's texture for a zeroed `Data3DTexture` of the same size and format (made once per lighting), and restores the recipe texture in `off`. The grid object and its selection box stay, so no program changes.
2. Environment gain: `scene.environmentIntensity = hdri.environmentGain × hdri.loaderCompensation`.
3. `loaderCompensation`: measured in a browser test on the fixture (generator writes the linear reference radiance into its sidecar JSON): `mean(reference) / mean(decoded)` over sky texels outside the sun cone. The raw decode is expected to be darker; the 2 % agreement is asserted after compensation. The research measured 1/0.95 on the real panoramas against the reference decoder; phase 2 records both numbers. Re-checked on every three upgrade (comment at the value and in the engine-revision note).
4. `environmentGain`: calibrated once on the real midday panorama (served from outside the repo) so that a horizontal 0.18 card outside every room box in walk reads what the same card reads under the recipe in walk within 5 %; the facade scenario's intent. Method: integrate the recipe rig's horizontal irradiance at the card (the analytic integration `lighting-standard.test.ts` already does for the environment, plus hemisphere, sun and fill), integrate the HDRI's (sky + derived sun), take the ratio, confirm by metering in the browser. The number and its measurement go in the value's comment.
5. Sun: the irradiance pass (`hdri-calibration.ts`) runs once per HDRI on the decoded half-float texels, upper hemisphere, every second row and column, weights `cos θ · dω`: `E_sky` outside a `sunConeDeg` (6°) cone around the stored direction and `E_residual` inside it. `E_sun_normal = max(0, E_sky · s / (1 − s) − E_residual) / sin(elevation)`; `sun.intensity = E_sun_normal × gain / luminance(colourLinear)` (Rec. 709 weights); `sun.color` = `colourLinear` in the working space. The walk sun factor inside rooms applies to it as to the recipe sun.
6. `skyBrightness`: measured through the chain's display transform on the three real panoramas. The walk OutputPass applies the exposure the HDRI divided out, so the window shows `Neutral(skyBrightness · sky)` whatever the exposure; that curve is evaluated on the decoded 2K skies (three's PBR Neutral, the sky above the horizon). PBR Neutral never clips, so the criterion is the knee: the value past which one more unit raises the median display value by less than 0.03, starting from the research's 2–4. One value for all panoramas.
7. `LIGHTING_STANDARD.hdri = { environmentGain, loaderCompensation, skyBrightness, sunConeDeg }`; no existing value changes; `LIGHTING_STANDARD_VERSION` stays 1, as for the lamp and baked additions.

### D7. Sun and shadow: one authority

`SunShadow` (`render/sun-shadow.ts`) stays the only writer of the sun's direction and frustum. It gains `override(elevationDeg | null)`: with an elevation, every later `refit`, `include`, `settle`, `endPreview` and `orient` computes the direction as `[sin W cos E, sin E, cos W cos E]` from the current site's `W = northDeg + preset.azimuth` and the override's `E`, fits with the same policy and moves the light; `null` returns to `sunDirection(site)` and refits. Because the azimuth is always read from the current site, a north-only edit while live needs no restore-and-reapply ordering, and nothing outside `SunShadow` snapshots a direction or a fit.

The sun's colour and intensity are not part of `SunShadow`: `HdriSky` sets them on the rig's sun light (found by its standard name, as the walk rig finds the hemisphere and fill), saving the standard values on the first set and restoring them on `off`. A new document or a context restore makes a new `SunShadow` (no override) and a new rig; `WalkLighting.load` restarts, and `HdriSky` applies the override and the light values again on its next full-lighting state, so no old snapshot is ever restored over a newly aimed sun. Order on leaving a full-lighting state: clear the override, then restore colour and intensity.

### D8. Rotation and its sign test

`rotationY = radians(northDeg + presetAzimuth − azimuthDeg)` on `scene.backgroundRotation.y` and `scene.environmentRotation.y`. Derivation: a Y rotation by θ adds θ to an azimuth measured clockwise from +Z towards +X (`x' = x cos θ + z sin θ`, `z' = −x sin θ + z cos θ`), taking the stored sun azimuth to `W`. three applies `environmentRotation` and `backgroundRotation` with its own inversions inside the renderer, so the sign is pinned by rendering, not by algebra:

1. Unit (bun): the pure function; the stored fixture sun direction rotated by `rotationY` with three's `Euler`/`Matrix4` equals `sunDirection(...)`'s azimuth.
2. Browser: the fixture (bright sun spot at a known azimuth and 40° elevation, a red marker 90° clockwise of it), north 30, preset noon. A camera aimed at `(W, 40°)` sees the spot within 3° of the image centre and the red marker to its right only when turned 90° clockwise; a mirror-like sphere's brightest highlight is on its side facing `W`; a post's shadow points along `W + 180°`. Run on SwiftShader and on `JEEX_BROWSER_GPU=nvidia`, recording the renderer string.

### D9. Sky brightness and fog

1. `HdriSky` in `display` sets `backgroundIntensity = skyBrightness / renderer.toneMappingExposure` after the rig's `reapply`; the rig skips its background save/divide/restore while `HdriSky` reports that it owns the background (`ownsBackground`), so neither cancels the other. Back in `off`, the rig's handling of the gradient is untouched.
2. Fog: `capture`, `display` and `sky-only` set `scene.fog = null`; `off` restores the saved fog object. Captures (`capture-commands.ts`) copy whatever fog the live scene has, so a still taken in `display` has no fog either.

### D10. Baked apartments

The controller reads the bake wiring's state each eligible frame. `waiting` and `loading`: only the sky is fetched (`loadHdriSky`), the environment is held back and `HdriSky` stays `off`. `applied`: `sky-only`. `off`, `refused` or `dropped` (including after an applied bake was dropped): the environment is fetched, the pair installed and full lighting follows through the normal hand-over (D3). The sky already loaded is reused. In `sky-only`: background = rotated sky at `skyBrightness / exposure`, fog off; environment, sun, exterior grid and room lighting stay as today. One `warn` `hdri-bake-daylight` per applied bake (a bake dropped and applied again warns again). The bake's own invalidation is untouched; HDRI-consistent baking is later.

### D11. Failure and lifetime

1. Failure of either file: abort the other, dispose what was made, log one `warn` `hdri-unavailable` with the preset (no URL in the message, it may be signed), mark the entry failed for this mount; a new document clears the mark.
2. Preset change: `setHdri(null)` moves `HdriSky` to `off`, disposes the pair, aborts a load in flight; the new entry loads on the next eligible frame. A load resolving for an entry that is no longer current is disposed on arrival.
3. Context loss: the controller disposes the lighting with the chain (existing lifetime); the pair is disposed with it and reloaded on the first eligible frame after the restore (the browser cache usually answers).
4. Unmount: `HdriSky` to `off`, pair disposed, before the lighting context detaches (spec `lighting-standard`).
5. Walk ↔ tour and visits to editing modes keep the pair installed; `off` is a restore, not a release.

### D12. Diagnostics

`__viewerDebug.hdri()` → `{ state: 'off' | 'loading' | 'ready' | 'live' | 'sky-only' | 'failed', preset: SunPresetName | null, cubeSize: number | null, sunIntensity: number | null }`. `ready` means installed and waiting for the swap.

### D13. Fixtures and generator

1. `scripts/make-fixture-hdri.ts <ultrahdr_app> <magick>`: outside every check tier, run by hand like `make-fixture-ktx2.ts`. It builds a 1024×512 linear float panorama procedurally (sky gradient, a Gaussian sun spot at azimuth 54° / elevation 40° in the panorama frame, peak well above SDR white, a saturated red marker 90° clockwise at 10°, a dark ground), encodes it with libultrahdr (`-m 0 -a 4 -t 0 -C 0 -c 0`, base and gain map quality 85, gain map at half size) into `tests/fixtures/hdri/sky-1k.jpg`, tone-maps a 256×128 copy and encodes it with ImageMagick to `tests/fixtures/hdri/sky-256.avif`, and writes `tests/fixtures/hdri/sky.json`: the entry's sun facts computed from the float data by the same scan the calibration uses, the reference radiance samples for the loader compensation, the encoder versions.
2. `scripts/make-fixture-hdri.test.ts` keeps them honest: JPEG with gain-map metadata (ISO 21496-1, which libultrahdr 2 writes, or `hdrgm` XMP) and an MPF segment; AVIF `ftyp`; sizes under 48 KB and 8 KB; the JSON passes the option schema once given two URLs.
3. Browser tests load them from the test server by absolute URL (`new URL('/tests/fixtures/hdri/…', location.href)`) through the real decoder and the browser's AVIF decoder. An empty-plan scene and the demo apartment cover both hand-over paths.

### D14. Budget

1. Walk chunk: three's `UltraHDRLoader` (research upper bound about 5.8 KB gzip) and the HDRI modules. Re-measure `lazy-jeex-viewer-walk-post` after `bun run build:lib` and set the limit to the new measurement plus 1 KB in `scripts/budget-check.ts` and its test, with the before/after numbers in the comment.
2. Boot: the schema and wiring only; measured before/after, reported. IIFE stays under 700 KiB with the chunk inline.
3. Lighting entry: unchanged limit; it gains only the four data values; `lighting-entry-check.ts` stays green.
4. The image pair (about 0.36–0.41 MB per preset with the real files) is reported separately; it is not JavaScript budget.

## Risks / Trade-offs

1. [three's renderer inverts rotations internally] → the rendering sign test is the source of truth; the unit test only checks the formula.
2. [The decoder's darkening changes with a three upgrade] → `loaderCompensation` is measured by a fixture test that fails on drift above 2 %.
3. [One `environmentGain` for panoramas encoded at different exposures] → the import step is the one encoder with fixed settings; a panorama far off shows in acceptance; per-image normalisation stays available later.
4. [Re-bake on arrival costs the bake time again] → the bake already runs on entry; the pair usually arrives within it, and only the first arrival re-bakes.
5. [Sky on baked apartments with a sun of a different elevation] → accepted until HDRI-consistent baking; reported once.
6. [Main-thread decode of the 1K gain map, about 30–40 ms] → measured in the browser in phase 2; worker decode is a later item.
7. [The sibling on-demand change edits the same render-demand files] → only an `invalidate()` call is added; rebased after it lands.

## Migration Plan

Additive. Without `lighting.hdri` nothing changes. Rollback is removing the option from the host.

## Open Questions

None. The `site`-less recipe choice and the no-retry-until-next-document choice are recorded in brainstorm.md for the review.
