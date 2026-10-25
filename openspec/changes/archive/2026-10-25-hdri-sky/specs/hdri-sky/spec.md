## Purpose

Lets a host give the viewer a real sky per sun preset, so walk and tour show that sky through the windows and light the apartment from it, while boot and the editing modes stay unchanged.

## ADDED Requirements

### Requirement: HDRI host option

The viewer SHALL accept `lighting.hdri`, a partial record keyed by sun preset name. Each entry SHALL hold `environmentUrl`, `skyUrl` and `sun: { azimuthDeg, elevationDeg, colourLinear, horizontalIrradianceShare }`; `azimuthDeg` is measured in the panorama's own frame, clockwise from +Z towards +X. The option SHALL be read at mount, SHALL be accepted only as a typed object passed to the mount, and SHALL have no query parameter and no attribute.

#### Scenario: Entry accepted
- **WHEN** a host mounts with `lighting.hdri.noon` holding two absolute https URLs and finite sun facts
- **THEN** the resolved options carry that entry unchanged and no warning is logged

#### Scenario: No transport by string
- **WHEN** a page passes a query parameter or an attribute named after the option
- **THEN** the resolved `lighting.hdri` is empty

#### Scenario: Default
- **WHEN** a host mounts without the option
- **THEN** the resolved `lighting.hdri` is empty and walk and tour look as before this change, pixel for pixel

### Requirement: HDRI option validation

Each entry SHALL be judged on its own: both URLs absolute with scheme `http`, `https` or `blob`; angles finite; elevation above 0 and at most 90; `colourLinear` three finite non-negative numbers whose largest is 1; share in [0, 1); no unknown keys; a key that is not a sun preset refused. A refused entry SHALL be dropped with one `option-invalid` warning naming its path, and the other entries SHALL be kept.

#### Scenario: Relative URL
- **WHEN** `lighting.hdri.morning.skyUrl` is `sky.avif`
- **THEN** the morning entry is dropped, one `option-invalid` warning names `lighting.hdri.morning`, and a valid noon entry beside it is kept

#### Scenario: Sun below the horizon
- **WHEN** an entry's `elevationDeg` is 0 or negative
- **THEN** the entry is dropped with one warning

#### Scenario: Colour not normalised
- **WHEN** an entry's `colourLinear` is `[2, 1, 0.5]`
- **THEN** the entry is dropped with one warning

#### Scenario: Unknown preset
- **WHEN** the record has a key `night`
- **THEN** that key is dropped with one warning and the other entries are kept

### Requirement: Active preset

The active preset SHALL be the scene's `site.sun` (`noon` when `site` is present without `sun`); a scene without `site` SHALL have no active preset. When the active preset has no entry, or there is no active preset, walk and tour SHALL use the recipe look. An entry SHALL never serve another preset.

#### Scenario: Entry for another preset only
- **WHEN** the option holds only `noon` and the scene's site names `evening`
- **THEN** walk shows the recipe look and nothing is fetched

#### Scenario: Scene without site
- **WHEN** the option holds all three presets and the scene has no `site`
- **THEN** walk shows the recipe look and nothing is fetched

### Requirement: Loading on demand

The pair of the active preset SHALL be fetched only on the first entry into walk or tour, both files concurrently, after the walk chain's code has loaded; in the ES and demo builds the decoder SHALL travel only in the walk chain's lazy chunk (the IIFE build carries it inline). Boot, the editing modes and other presets SHALL fetch nothing. A pair already installed SHALL be reused across walk and tour switches without a new fetch.

#### Scenario: Boot fetches nothing
- **WHEN** the viewer is mounted with the option and stays in orbit
- **THEN** no request for either URL is made, and the ES and demo boot graphs contain no gain-map decoder

#### Scenario: Concurrent pair
- **WHEN** the viewer first enters walk
- **THEN** both URLs of the active preset are requested before either response has completed

#### Scenario: Walk to tour and back
- **WHEN** the viewer goes walk → orbit → tour → walk after the pair was installed
- **THEN** no further request for either URL is made

### Requirement: Hand-over to the HDRI

Until both files are decoded and prefiltered, walk and tour SHALL keep the current look. The HDRI's sky, environment and sun SHALL go live in one frame, together with room lighting captured under the HDRI: with closed rooms the room lighting is re-baked under the HDRI and the swap frame shows all of it; with no closed room the HDRI goes live in the first eligible frame after it is ready.

#### Scenario: Slow sky
- **WHEN** the environment file has arrived and the sky file is still loading
- **THEN** walk shows the gradient sky and the recipe lighting

#### Scenario: Agreement at the swap
- **WHEN** the first frame showing the HDRI sky is drawn in a scene with closed rooms
- **THEN** that frame's room lighting was captured under the HDRI environment and sun

#### Scenario: Empty plan
- **WHEN** a scene with no closed room is walked with an entry for its preset
- **THEN** the HDRI sky is shown once the pair is ready, although no room lighting exists, the hemisphere and fill lights contribute nothing, the renderer exposure stays the editing one, and a grey card outside reads the HDRI-lit value within 5 % (not that value plus the recipe's hemisphere and fill)

#### Scenario: Empty plan back to orbit
- **WHEN** the viewer leaves walk after the empty-plan HDRI was live
- **THEN** the hemisphere and fill have their editing intensities again

### Requirement: Visible sky

While the HDRI is live in walk or tour the scene background SHALL be the display sky as an equirectangular sRGB texture, at the brightness the walk chain's HDRI sky policy sets (capability `walk-post-processing`), rotated as the environment is.

#### Scenario: Sky in a window
- **WHEN** a window facing the panorama's sun is viewed in walk
- **THEN** the window shows the fixture's bright sun spot, not the gradient

### Requirement: HDRI environment and exterior light

In the full-lighting states (walk and tour `display`, and `capture` during the room lighting bake; not while waiting for the swap, not in the editing modes, not on a baked apartment) the environment SHALL be the prefiltered HDRI at the standard's HDRI environment gain. Room probes SHALL keep lighting reflections inside rooms; outside every room box the HDRI SHALL supply diffuse and specular light and the exterior grid SHALL add no light.

#### Scenario: Facade under the HDRI
- **WHEN** a facade outside every room box is read in walk with the HDRI live, with the exterior grid's coefficients doubled
- **THEN** its reading does not change

#### Scenario: Room probe still wins indoors
- **WHEN** a glossy floor inside a windowless room is viewed with the HDRI live
- **THEN** its reflection contains no part of the panorama

### Requirement: Sun from the HDRI

In the full-lighting states the analytic sun SHALL shine from world azimuth `northDeg + presetAzimuth` at the entry's elevation, in the entry's colour, with the intensity the standard's calibration derives from the decoded sky's measured irradiance and the entry's share; its shadow frustum SHALL be refitted. Leaving walk and tour SHALL restore the preset's sun and frustum.

#### Scenario: Elevation from the entry
- **WHEN** the noon entry says elevation 43 and the site says north 30
- **THEN** in walk the sun shines from world azimuth 210° at 43°, and in orbit again from 210° at 55°

#### Scenario: Intensity follows the share
- **WHEN** two entries with the same images and no residual sun-cone irradiance differ only in share, 0.5 and 0.75
- **THEN** the second sun's intensity is three times the first's within 1 %

#### Scenario: Intensity with a residual
- **WHEN** the sky outside the cone gives horizontal irradiance A, the cone residual R, share s and elevation E
- **THEN** the sun's normal irradiance is max(0, A·s/(1−s) − R) / sin E within 1 %

#### Scenario: Sun survives edits while live
- **WHEN** a caster is moved and then the site's north alone is changed while the HDRI is live in walk, and the viewer returns to orbit
- **THEN** in walk the sun keeps the entry's elevation at the new world azimuth with a frustum holding the moved caster, and in orbit it is the preset sun at the new north with its preset fit

### Requirement: Rotation of sky and environment

Background and environment SHALL be rotated about the vertical axis by `radians(northDeg + presetAzimuth − azimuthDeg)` so the panorama's sun stands where the analytic sun shines from.

#### Scenario: Sun spot, reflection and shadow agree
- **WHEN** the fixture with a bright spot at a known azimuth is walked at a non-zero north
- **THEN** the spot appears in the background in the direction the sun shines from within 3°, a mirror-like sphere reflects it on the side facing the sun, and the sun's shadows fall away from it

### Requirement: Room lighting captures under the HDRI

Grid and probe captures with the HDRI installed, the re-capture of a room whose probe point an edit moved included, SHALL see the prefiltered HDRI as background at the HDRI environment gain, never the display sky, and SHALL restore the display sky afterwards; captured room probes SHALL never be an input of a capture.

#### Scenario: Capture background
- **WHEN** a room grid is baked with the HDRI installed and the display sky's brightness doubled
- **THEN** the baked grid does not change

### Requirement: Fog with the HDRI

While the HDRI is live in walk or tour, or installed during captures, the gradient fog SHALL be off; it SHALL be back in the editing modes and whenever the recipe look is shown.

#### Scenario: Fog restored
- **WHEN** the viewer leaves walk with the HDRI live
- **THEN** the scene's fog is the gradient fog again, with the same colour and range

### Requirement: Editing modes unchanged

Leaving walk and tour SHALL restore exactly what the editing modes showed before: background, its brightness and rotation, the environment, its gain and rotation, the fog, the sun and its frustum, the exterior grid.

#### Scenario: Orbit pixel identical
- **WHEN** the viewer enters walk, the HDRI goes live, and the viewer returns to orbit
- **THEN** an orbit frame is pixel-identical to one taken before entering walk

### Requirement: HDRI failure

A fetch, decode (including a corrupt embedded image) or prefilter failure of either file SHALL settle the load as one failure, log one `hdri-unavailable` warning naming the preset, release whatever part was made, and keep the recipe look; the same pair SHALL NOT be fetched again during this mount until another document is loaded.

#### Scenario: Missing sky
- **WHEN** the sky URL answers 404
- **THEN** one warning is logged, walk keeps the recipe look and the gradient, and re-entering walk makes no new request

#### Scenario: Corrupt gain map
- **WHEN** the environment file's embedded gain-map image cannot be decoded
- **THEN** the load settles as a failure, no texture or bitmap is left, and exactly one warning is logged

### Requirement: HDRI lifetime

A change of the active preset SHALL detach and release the previous pair before or as the next one installs and SHALL fetch the new one on demand; a load finishing for a preset no longer active, a lost context or a disposed viewer SHALL be released at once; a lost context SHALL release every HDRI resource and the next eligible frame after the restore SHALL load the pair again; unmount SHALL release everything.

#### Scenario: Preset change in walk
- **WHEN** the site's sun changes from noon to evening while the noon HDRI is live in walk
- **THEN** walk shows the recipe look until the evening pair is ready, the noon textures are disposed, and the GPU texture count returns to its value with one pair installed

#### Scenario: Repeated switches
- **WHEN** the site's sun is switched ten times between two presets with entries
- **THEN** after the last pair is installed the GPU texture and geometry counts equal those after the first installation

### Requirement: Baked apartments

While a light bake is pending or applied, only the sky SHALL be fetched; with it applied, walk and tour SHALL show the rotated sky with the fog off while environment, sun and grids keep the daylight path, and log one `hdri-bake-daylight` warning per applied bake. A dropped or refused bake SHALL release the hold: the environment is fetched and full HDRI lighting follows.

#### Scenario: Baked room in walk
- **WHEN** a baked apartment with an entry for its preset is walked
- **THEN** the windows show the panorama, a baked floor reads as without the option within the walk tolerance, only the sky URL is requested, and one warning is logged

#### Scenario: Bake arrives late
- **WHEN** walk is entered while the bake is still loading and the bake is then applied
- **THEN** the environment URL is never requested and full HDRI lighting is never installed

#### Scenario: Bake dropped
- **WHEN** an applied bake is dropped by an edit while in walk
- **THEN** the environment URL is requested and full HDRI lighting goes live with the next room lighting swap

### Requirement: HDRI diagnostics

The debug surface SHALL report the HDRI state: `off`, `loading`, `ready`, `live`, `sky-only` (a baked apartment) or `failed`, with the active preset and the environment's cube size.

#### Scenario: Live state
- **WHEN** the HDRI has gone live in walk with the 1K fixture
- **THEN** the debug read says `live`, the preset, and a cube size of 256
