# Changelog

All notable changes to this project are documented in this file. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
as described under [Versioning](#versioning).

## [Unreleased]

### Added

- **Light temperature.** The interior's artificial light (the object bank's
  lamps and the walk ambient floor) takes a colour temperature from 2700 K to
  6500 K in steps of 100, or «Original» (the default, today's look). Daylight,
  the studio environment and material previews do not change. Set it with
  `lighting.temperature`, the live `light-temperature` attribute,
  `?lightTemperature=`, `handle.setLightTemperature` (anything else throws
  `bad-params`) or the iframe command `setLightTemperature`; read it from
  `getState().lightTemperature` and the `lightTemperature` event
  (`jeex-light-temperature`, iframe event `lightTemperature`).
- **Settings button and panel** (`settings.show`, attribute `settings`, query
  `settings`; off by default): attached to the control bar's end next to
  Interior styles without moving any control, under the bar's end in viewers
  600 px wide or narrower, opening a non-modal panel with the light
  temperature. Hosts that place their own button at the bar's end need to leave
  room for it, or choose the other side with `settings.side`.
- **Settings side** (`settings.side: 'start' | 'end'`, attribute
  `settings-side`, query `settingsSide`; default `'end'`, read once at mount):
  attaches the settings button to the control bar's start instead of its end,
  beside it or under it in narrow viewers, with the panel anchored by its start
  edge and the button first in the bar's keyboard order. Start and end follow
  the bar's writing direction. Under the bar the plate moves along its row past
  the producer's mark and a lifted walk minimap, which keep their places.
- `jeex-viewer/lighting` exports `colourTemperatureRgb` and
  `isLightTemperature`, and `LIGHTING_STANDARD.temperature` holds the range.
  `LIGHTING_STANDARD_VERSION` stays 1.

### Changed

- **Breaking for readers of `exportGlb` metadata: a wall face is addressed,
  not identified.** In the `EXT_structural_metadata` table `jeexElements`, a
  `wallFace` row no longer carries a GUID the viewer derived from its room,
  wall and side: its `guid`, `ifcGuid` and `id` are `null`, and the class
  declares those three properties `required: false`. Find a face by `wallId`
  and `side` (one face per wall side); `roomId` still names the room it is seen
  from and is `null` on the facade. Face rows are now ordered by `wallId`, then
  `side`, so wall meshes point at different row indexes than before;
  wall, room, opening and furniture rows keep their UUIDs and their order. The
  scene document and its schema do not change.
- **Direct sunlight inside rooms in walk and tour** is scaled to the walk
  exposure, so sunlit floors keep their texture; facades and the editing modes
  keep their sun.
- **Breaking for light-DOM hosts: the chrome holds its look against the
  page's global CSS.** With `mountViewer` or `<jeex-viewer shadow="none">`,
  unlayered page rules no heavier than one class, attribute or pseudo-class
  plus three element names (`button {}`, `* {}`, `.entry-content p a {}`) no
  longer restyle the chrome's buttons, text and icons. Weak overrides such as
  a bare `.mode-button {}` stop winning as well. On both paths the root's (and
  the page `body`'s) font family, size, weight, line height and spacing, and
  its colour, no longer reach the chrome's text. The documented overrides
  still work: `.jeex-viewer …` rules, the theme custom properties, `::part()`
  and slots.
- **`<jeex-viewer>` starts its viewer only when it is about to be seen.** The
  element holds its box from `connectedCallback` and starts the viewer when it
  comes within 100 px of the viewport, or on a pointer press or a focus inside
  it; a browser without `IntersectionObserver` starts at once. The viewer's code
  (three.js included) is now a `lazy-jeex-viewer-element-runtime-<hash>.js`
  import made at that start, so the element bundle's eager download drops from
  about 428 KB to about 39 KB gz. `el.viewer` is a handle from the connect on:
  before the start it queues commands, answers queries as a viewer before its
  first scene does, and its `ready` resolves with the started viewer's first
  frame. A below-the-fold element fires `jeex-ready` only after it was scrolled
  near, and an attribute changed before the start is applied instead of being
  reported as read once. A failed fetch of the viewer's code fires `jeex-error`
  with code `internal`. `mountViewer` and the iframe page start at once, as
  before; the IIFE bundle starts deferred but still carries the whole viewer.
- **`loading` on `<jeex-viewer>`**, spelled like `<img loading>`: `lazy` (the
  default, and any unknown or empty value) is the deferred start above, `eager`
  starts the viewer at connect as before. The `loading` property reflects the
  attribute; setting `eager` on an element that has not started starts it, and
  a change after the start does nothing.
- **One WebGL context per viewer.** The support probe now takes its context
  on the viewer's own canvas and the renderer keeps it, instead of a throwaway
  probe context followed by the renderer's own. A browser with WebGL 1 but no
  WebGL 2 now gets the "no WebGL" card (`webgl-unavailable`) instead of a
  `scene-load` failure. `mountViewer` and the iframe page now hear that
  `webgl-unavailable` failure, because the viewer's boot runs one microtask
  after `mountViewer` returns, so an iframe parent receives an `error`
  message where it got none before.
- **The procedural noise tiles are drawn while the scene loads.** The shared
  noise tiles behind the floor, wall and fabric textures are drawn in slices of
  about 8 ms while the scene document is on its way, instead of inside the one
  task that builds the scene. The pixels do not change.

### Added

- **KTX2 textures.** Furniture GLBs that use `KHR_texture_basisu` and library
  room maps shipped as `tex/<versionId>/<role>.<px>.ktx2` are decoded by
  three's Basis Universal transcoder into the GPU's compressed formats. The
  transcoder ships next to the player's files in every build as
  `lazy-jeex-viewer-basis-transcoder-<hash>.js` and `.wasm`, is found from the
  folder of the running player file (ES entry, custom element, iframe page and
  IIFE alike), and is fetched only when a document first needs KTX2. A KTX2
  room map is drawn the same way up as its WebP twin, with its own mip levels
  and the colour space of its role. A KTX2 GLB that cannot be transcoded is
  refused with `detail.reason: 'ktx2-transcoder'` and keeps its procedural
  body. New log codes `texture-ktx2` and `texture-colour-space`. Hosts that
  serve `dist-lib/` must also serve `.wasm` as `application/wasm`; the CSP
  section lists what KTX2 needs. `jeex-viewer.iife.js` grows by about 26 KB
  gzip (the loader code it carries inline).

- **`set_room_purpose`: a scene operation for what a room is for.**
  `{ op: 'set_room_purpose', roomId, purpose: RoomPurpose | null }` on schema
  2.4 documents: a vocabulary value sets the room's `purpose`, `null` removes
  the field, and the value the room already has (or a clear of an absent one)
  is accepted and changes nothing. The vocabulary is closed, thirteen values
  in `ROOM_PURPOSES`: `living`, `kitchen`, `kitchen-living`, `bedroom`,
  `kids`, `study`, `bathroom`, `wc`, `hall`, `corridor`, `storage`,
  `utility`, `balcony`. Refused on pre-2.4 documents (the version is never
  raised by an operation), on an unknown room and on a value outside the
  vocabulary; interior presets may not carry it. A purpose change draws
  nothing: the operation's `touched` is empty, and a replaced document that
  differs only in room purposes and `schemaVersion` diffs to no touched
  entity. `RoomPurpose`, `SetRoomPurposeOp`, `ROOM_PURPOSES`,
  `SCHEMA_VERSIONS` and `schemaVersionBefore` are exported from
  `jeex-viewer/ops`; the published scene schema refuses a `purpose` in a
  pre-2.4 document.

- **Scene schema 2.4: `Room.purpose`.** An optional field on every room,
  from the closed vocabulary above; absent means not declared, with no
  default, and no rule reads it against `kind` (a loggia may be a study, a
  room a balcony). 2.2 and 2.3 documents stay readable; one that carries a
  `purpose` is refused (`room-purpose-needs-schema-2-4`), an unknown value as
  `room-purpose-unknown`. The demo apartment now ships as 2.4 with a purpose
  on every room.
- **Room lighting in walk and tour.** Each room is lit by its own baked
  light-probe grid (one bounce through doorways) and reflects itself through a
  box-projected reflection probe; the sky light, the fill and the
  environment's diffuse term no longer reach through walls in those two
  modes, so a windowless room is darker than a room with a window. The bake
  runs on entry over several frames with the direct look meanwhile, then
  switches in one frame; edits refresh only the rooms they touch. Editing
  modes render exactly as before. Shell meshes (walls, floors, ceilings,
  skirtings, joints) now have their origins inside their rooms; their
  world-space vertices are unchanged. The walk chunk grows by about 12 KB
  gzip. `__viewerDebug.walkLighting()` reports the phase and the measured
  bake.

- **`set_site`: a scene operation for the plan's orientation and sun preset.**
  `{ op: 'set_site', northDeg?: number | null, sun?: 'morning' | 'noon' | 'evening' | null }`
  on schema 2.3 documents: a value sets the field, `null` clears it, an omitted
  key keeps it; `northDeg` is normalised to [0, 360); clearing both removes
  `site`. Refused on 2.2 documents and inside interior presets. A change of
  `site` (by the operation or by a replaced document) reports the new touched
  kind `site`, and the live viewer re-aims the sun without a rebuild.
  `SetSiteOp` is exported from `jeex-viewer/ops`; the published scene schema
  requires one of the two keys.

- **Ambient occlusion and SMAA in walk and tour.** In the two modes where
  nothing is edited, the player renders through a post-processing chain:
  three.js GTAO (0.3 m radius, full resolution, denoised) darkens corners,
  skirtings and the ground under furniture, SMAA smooths edges, and the PBR
  Neutral display transform is applied once at the end. Glass, transparent
  surfaces and invisible pick shapes cast no occlusion. Editing modes render
  exactly as before. The chain loads on the first entry into walk or tour: a
  separate chunk of about 50 KB gzip in the ES module and demo builds, inline
  in `jeex-viewer.iife.js` (which grows by about 50 KB gzip). Stills and video
  frames captured in walk or tour go through the same chain; panoramas do
  not. Mirrors still reflect once per frame. `__viewerDebug.walkPost()` (debug
  mounts only) reports the chain's state.

- **Scene schema 2.3: `site`, the plan's orientation and a sun preset.**
  `site: { northDeg?, sun? }` says where true north lies (degrees clockwise
  from `+Z` towards `+X`) and which sun preset lights the scene: `morning`,
  `noon` or `evening` (artistic, not astronomical). An empty `site` is north
  along `+Z` at `noon`; a document without `site` keeps the sun of earlier
  versions. 2.2 documents stay readable and may not carry `site`; the
  published JSON Schema says the same.
- **`jeex-viewer/lighting`: a controllable apartment sun.**
  `createApartmentRig` returns an `ApartmentRig` with `shadowMapSize`,
  `setSunDirection`, `setShadowFrustum`, `markShadowDirty` and `shadowDraws`,
  and takes a new option `shadowCache` (default `false`). The entry also
  exports `sunDirection`, `LEGACY_SUN_DIRECTION` and `fitShadowFrustum`; the
  standard publishes the sun presets and the shadow fit tuning.
  `LIGHTING_STANDARD_VERSION` stays 1: no existing rig value changed.
  Existing rigs keep working unchanged.
- **Project library materials in the manifest.** A project material may now
  be a `library` member, `{ versionId, kind: 'scan' | 'parameters', facts,
  maps }`, the shape a catalogue bake writes for a scanned texture set or a
  parameter-only material. It is strict at every depth and judged whole:
  colour map by colour mode, `arm` or `roughness`, colour space by role, one
  size set per material from 128, 256, 384, 512 and 768, the exact
  `tex/<versionId>/<role>.<px>.webp` path of every file, glTF value ranges,
  no texture path listed twice. Nothing is defaulted while reading. `apply`
  gains `ceiling`, `facade` and `trim`. A refusal inside a material names the
  member's own field, and an unknown key is named in the message.
- **Texture limits.** `MAX_TEXTURE_FILE_BYTES` (2 MiB per file),
  `MAX_PROJECT_TEXTURE_BYTES` (48 MiB per document) and
  `MAX_PROJECT_TEXTURE_FILES` (512 listed files) in the shared limits module;
  a manifest listing more than 512 texture files is refused.
- **Scene schema 2.3: library finishes** (the same 2.3 as `site`). A finish value may be a finish object,
  `{ material, colour?, rotation? }`, naming a project library material with a
  tint or a texture rotation, wherever a finish UUID stands; a room may name
  its `ceiling` and its `trim`. 2.2 documents are still read; a 2.2 document
  that uses a 2.3 field is refused with `finish-needs-schema-2-3`. The new
  validation rules are `finish-invalid`, `finish-needs-schema-2-3` and
  `finish-modifiers-need-library`. The published scene JSON Schema carries the
  finish value, the colour pattern and the new version.
- **Library materials drawn on room surfaces.** A project's `library`
  materials dress floors, walls, ceilings, facades and baseboards with their
  maps: flat on the first frame, the maps fetched afterwards at one size per
  document by the WebGL context's capability class, shared between surfaces,
  released on repaint and unmount, and rebuilt from kept bytes after a lost
  rendering context. Wall reveals and baseboards carry metre UVs. A room's
  ceiling and trim finishes are drawn. New warnings: `texture-location`,
  `texture-fetch`, `texture-decode`, `texture-size-mismatch`,
  `texture-too-large`, `texture-budget`, `texture-deadline`.
- **`resolveTexture` viewer option** (object spelling only): a host resolver
  that turns a logical texture path into the URL to fetch, called lazily per
  size loaded; absent from the published viewer options schema.
- **Library materials in the swatches and `describeSelection`**, listed by
  surface word before the bundled finishes, with explicit `set_material`
  operations; `SelectionScope.ops.all` is absent when the material cannot
  dress the surface the broad action paints.
- **`set_material` explicit form**, `{ surface, room?, face?, material,
  colour?, rotation? }`: the surface is named, never inferred, and checked
  strictly against the material's `apply`. Its results touch the new
  `ceiling` and `trim` kinds per room. `SceneRegistries` gains
  `finishSurfaces(id)` and `isLibraryMaterial(id)`, and `LibraryFinish` an
  optional `library` flag that `projectLibraryOf` sets. Both registry members
  are optional: registries a host built by hand derive the surfaces from
  `finishKind` and name no library material. `jeex-viewer/ops` exports the
  types `FinishRef` and `SetMaterialSurfaceOp`.

- **`jeex-viewer/lighting`: the lighting standard as a public entry.**
  `createLightingContext(three, renderer)` binds it to your own three.js
  (revision 186) and renderer; `createReferenceRig()` and
  `createApartmentRig({ shadowMapSize })` light a scene with exactly what the
  player uses; `LIGHTING_STANDARD` and `LIGHTING_STANDARD_VERSION` describe
  it. The entry carries no three.js and no DOM access. See the README,
  «Lighting standard».
- **Anonymous telemetry, on by default.** The player sends anonymous usage
  and error counts to `https://telemetry.jeex.org/v1/player`: lifecycle
  (`view`, `ready`, `models_loaded`), capped action counters, room time
  buckets, coarse device buckets and player errors, each group as its own
  `POST` without credentials or referrer. Payload schema `1.0.0`
  ([TELEMETRY.md](TELEMETRY.md), `telemetry.schema.json`, also exported as
  `jeex-viewer/schema/telemetry.json`). No cookies or storage, no
  identifiers, no fingerprint, no error messages. Turn it off with the new
  option `analytics` (`analytics="off"`, `?analytics=off`,
  `{ analytics: { mode: 'off' } }`); Global Privacy Control turns it off
  too; `analytics-endpoint` sends elsewhere. A site with a Content Security
  Policy adds the endpoint to `connect-src`.
- **Embed protocol: `context` command.** The host helper hands the frame
  its page path after the frame loads, by `postMessage` only, so the
  frame's telemetry can name the page without the path appearing in any
  URL. A hand-written host may send `{ method: 'context', params: { page } }`
  itself; the frame answers it before `ready` too.

### Changed

- **The first picture waits for the scene's shaders, and `ready` waits for
  the first picture.** The player compiles the scene's shaders asynchronously
  before its first picture (parallel linking off the main thread where the
  browser has `KHR_parallel_shader_compile`, at most 1 s), so the first frame
  no longer blocks the page for the links; the walk and tour chain does the
  same for its own target before it attaches, and so does a restored GPU
  context. `ready`, `__appReady` and the reveal of the viewer now come after
  the first picture is drawn (before, they came just before it), so a host
  that screenshots on `ready` never sees a blank canvas; a viewer mounted
  hidden fires them once its shaders are ready, and draws when it is shown.

- **Walk and tour draw on demand.** In `walk` and `tour` the player draws a
  new picture only when something on screen can have changed (the camera,
  an edit or rebuild, a door or furniture animation, a model or texture that
  arrived, the selection, the floor cursor, the sun's shadow, the room
  lighting, a resize, a canvas shown again or a restored GPU context); a
  resting view keeps its last picture and draws nothing. Editing modes are
  unchanged and nothing changes in the public API. The telemetry `fps`
  shares now count only the time between two consecutive drawn frames, so a
  view at rest is no longer read as slow frames, and room `dwell` keeps
  counting while the visitor stands still.

- **The sun respects the apartment.** Its shadow is fitted to the walls,
  ceilings, floors, furniture and door swings of the scene on screen (no more
  fixed square that clipped large plans and wasted the map on small ones),
  and drawn only when something that casts or receives changed. Ceilings
  block the sun in every view and walls cut away by the overview keep their
  shadow, so in an overview sunlight reaches the floors only through windows
  and doors. Scenes look different where light used to fall through the
  missing ceilings: that is intended.
- **`set_material` legacy form reads the surface table.** A facade-only
  project material may paint the facade and a facade face through the legacy
  form. Two legacy cases change on purpose: a room `target` now refuses a
  material that dresses neither floors nor walls (one whose `apply` names
  only, say, `furniture`, which used to land on the walls), and a project
  material that dresses both floors and walls may now dress walls in a 2.2
  document too. Everything else a 2.2 document could do behaves as before. Interior
  presets read the explicit form's `surface` for their coverage and reset,
  and restore a finish object through the explicit form in its exact
  spelling.
- **`jeex-viewer/ops` budget** raised to 78.8 KB gzip for the library
  member and the finish values it now carries.

- **The player lights with the new standard: PBR Neutral instead of ACES
  Filmic.** Neutral keeps a material's hue and saturation where ACES washed
  them out, so colours read truer and the demo looks somewhat different.
  The synthetic room environment is replaced by a generated grey studio;
  the sun and sky light are less warm. Swatches in the selection panel are
  rendered under the reference rig and tone mapped once, and the
  development furniture gallery uses the reference rig too.
- **three.js 0.186.1** (from 0.185.1), with `@types/three` 0.186.0.
- **The demo apartment is a new, invented flat.** The scene the demo pages
  and the player site ship (`src/demo/`, published as
  `demo/demo-apartment.json`) is now `Two-bedroom demo apartment`: an
  invented two-bedroom flat with a study, a curved bay and a loggia, drawn
  for the player and furnished from the built-in bank. Every demo entity id
  (scene, nodes, walls, openings, rooms, placements, interior presets) is
  new, so a host that addressed demo entities by id reads them from the new
  document; a saved copy of the previous demo document still loads, since
  the schema and the catalogue ids are unchanged. The first interior preset
  is now called "Oak and sand". The library build is not affected.

### Changed (breaking)

- **Scene finish types widen to `FinishRef`.** `RoomFinishes.floor` and
  `walls`, `SceneFinishes.facade` and `FaceFinish.finish` are now
  `FinishRef` (a material UUID, or `{ material, colour?, rotation? }`), and
  `SetMaterialOp` is a union of the legacy `target` form and
  `SetMaterialSurfaceOp`. A TypeScript host that reads these fields as
  strings, or reads `op.target` without narrowing, gets the material UUID
  through `floorFinishOf`, `roomWallFinishOf`, `facadeFinishOf` and
  `faceFinishOf`, and narrows the operation on `'surface' in op`.
- **`TouchedEntity` gains `ceiling` and `trim`.** A host that switches over
  every kind handles the two new ones.
- **A project material may be a `library` member.** Next to `pbr` and
  `generator`, a material in `manifest.library.materials` may carry
  `library` instead; code that reads `m.pbr` whenever `generator` is absent
  checks for `library` first. `FinishApply` (and `apply` of a library
  finish) gains `ceiling`, `facade` and `trim`.
- **`SelectionScope.ops.all` is optional.** It is absent when the material
  cannot dress the surface the broad action paints; a host hides that action.
- **Scene schema `2.2`: a placement's catalogue reference is two fields.**
  `DemoAsset.asset` and the `place_object` operation's `asset` are a bare
  archetype or variant UUID; the new optional `library` is the UUID of the
  library that holds it. A placement without `library` belongs to the
  document's `assetLibrary`, and when that is absent too, to the built-in
  bank. `asset`, `library` and `assetLibrary` must be UUID v7: the composite
  `library:asset_uuid` string is refused (`asset-reference-invalid`), a
  non-UUID library as `asset-library-invalid` or
  `scene-asset-library-invalid`, a `library` without an `asset` as
  `asset-library-without-asset`, and the built-in bank's own id
  (`starter:interior-v1`) is never written into a document — a placement
  from the built-in bank names no library. `place_object` writes `library`
  into the placement exactly when the operation names one.
- **Only `schemaVersion: '2.2'` is read.** A `2.0` or `2.1` document is
  refused with `schema-version-unsupported`; the player converts nothing, so
  a producer rewrites its documents: keep the UUID after the last colon of
  `asset` as `asset`, move the part before it into `library` (or
  `assetLibrary`) — or drop it when it is the built-in `starter:interior-v1`,
  which is never written — rewrite `assetLibrary` the same way, and set
  `schemaVersion` to `2.2`. The published JSON Schema carries the UUID
  pattern on `asset`, `library` and `assetLibrary`.
- **`jeex-viewer/ops`:** `SceneRegistries` no longer has a `parseAssetRef`
  member; the new export `assetRefOf(fields, defaultLibrary)` (type
  `AssetRefFields`) is the one rule a reference is read by. `mirror_object`
  no longer rewrites `schemaVersion`. `suggestPlacement`'s
  `PlacementRequest.asset` is a bare UUID too (a `library:asset` string no
  longer resolves) and takes an optional `library`, as `place_object` does.
- **Rendered and exported furniture:** `userData.assetRef` (the composite
  string) is replaced by `userData.assetLibrary`, and the GLB element
  metadata table gains a `libraryId` column next to `assetId`. Both carry the
  library UUID the document names for the placement (its `library`, else
  `assetLibrary`) and are absent for the built-in bank.

### Fixed

- **Built-in objects match the sizes and facts they declare.** The dining
  chair's rear posts stand on the floor as its back legs; the media unit is
  as tall as its dims (1.366 m, 1.512 m for the 2.2 m variant) and its
  screen is a near-black, glossy, unlit panel on a black-glass bezel, through
  a new finish `screen_tv` (in `CATALOGUE_ID_BY_SLUG`); houseplant crowns reach
  their declared height; the island, vanity and bath declare their carcass top
  as `layout.blockingHeight` (0.94, 0.88, 0.58 m), so a tap never sets how high
  they block; the vanity's vessel basin is open.
- **A baked project's own furniture collides and is drawn on the plan.**
  Walk obstacles, the 2D plan's fixture outlines, the tour's room routes and
  checkpoints read only the built-in objects, so a project whose library
  carries its own ids was walked through and its bath and kitchen were missing
  from the plan. Every floor question (walk, plan, layout rules, free-space
  suggestions, dragging) now reads the project's library first and the
  built-in objects behind it, by one rule: a placement's `collision`, else a
  floor object at least 0.15 m tall (`layout.blockingHeight` when declared)
  with `dims` times `layout.footprint` (a fraction). `projectLayoutCatalogue`
  follows the same rule, so a project rug no longer reports wall, overlap or
  door-zone issues and a plant is judged by its pot.
- **The degraded-asset notice stays clear of host boxes and the hint card.**
  It is lifted, measured live, 8 px above every filled `bottom-left`,
  `bottom-center` or `bottom-right` box and the hint card it would overlap; a
  bottom-center host bar covered it, and at phone width it lay on the hint.
- **The IIFE build reads its own folder only from a real script element.**
  The folder the Basis transcoder is fetched from comes from
  `document.currentScript` in the IIFE build; a page could shadow that
  property with any element it names `currentScript`. Anything but an
  `HTMLScriptElement` is now ignored.
- A disposed model source now frees the textures of the GLBs it parsed, not
  only their geometries and materials.

- **Tintable library scans draw at their real brightness.** A tint map
  written by the `luma-mid@1` recipe is normalised to a mid-grey mean, and
  the tint was multiplied in without undoing that, so a scan in its own
  colour drew about 4.6 times too dark in linear light (a mid tone came out
  at about half its brightness). The tint is now scaled
  by the recipe's gain (the inverse of mid grey in linear light) on the
  first frame and once the map has arrived; natural scans and tintable
  paints are unchanged.
- **A viewer taken off the page without `dispose()` stops drawing.** Its
  render loop kept drawing into the detached canvas on every frame, which on
  a software rasteriser could stall the next page load in the same browser
  for about a minute. The loop now pauses while the canvas is not in a
  document and resumes by itself when the host puts it back; nothing is
  disposed, and `dispose()` remains the way to tear a viewer down. A viewer
  started while its canvas was hidden by `display: none` now also starts
  drawing once its box appears.
- **A restored rendering context keeps the project.** Recovery remounted the
  committed document without its project options, so a restored bake lost
  its model resolver, materials and catalogue; it now remounts with
  everything the document was mounted with.

- **The demo tour no longer walks through door leaves, grazes walls or stares
  into them.** The demo flat's authored tour walked through the open leaves
  of the bathroom, guest-room and loggia doors (inside them or within 0.01 m
  at about 38, 48, 54 and 58 s of the 73 s run), passed within 0.06-0.3 m of
  other leaves and door jambs, and at several points kept its gaze on the
  previous room's object while walking away from it, so the frame filled
  with the wall in between. Its waypoints now cross every door straight
  through its centre and walk the hall clear of the open leaves, its gaze
  keys hand over to the next room before the camera leaves one, the kitchen
  and guest-room doors open into their rooms, and the bathroom door is
  hinged on its west jamb. The run is now 78 s long (69.5 m). A test samples
  the played tour and holds it to the walls and the leaves. Only demo
  content changed; the player is unchanged.
- **The mini-map no longer sits under a claimed `bottom-right` slot.** In
  walk and tour, a host box in `bottom-right` (for example a 56px assistant
  button) covered the card's lower-right corner. The card now rises 64px
  above it, as the camera preview, the degraded-asset notice and the tour
  bar already did; without that slot the card stays where it was.
- **The mini-map no longer covers the walk camera stepper on a phone.** In
  a viewer narrower than 562px the stepper (previous, «i / n», next) at the
  bottom centre reached under the card: at 390x844 the stepper ran 132-258
  px across and the card 212-376 px. The stepper keeps its place and the card
  now stands 8px above it while it is shown; that lift already covers a
  claimed `bottom-right` box. In a short viewer the card shrinks to stay
  under the control bar, and below 298px of height it steps out instead of
  shrinking under 96px. Tour, a document without tour cameras, wider
  viewers and browsers without `:has()` keep the card where it was.
- **An authored tour's gaze no longer snaps in one frame on a wide turn.**
  Between two gaze keys the look turned along the short arc, taken again on
  every frame. Both looks move with the camera, so when the gap between them
  passed 180° during the turn, the turn flipped to the other side and the
  view jumped: by 35° and 57° on the demo tour (11.8 s and 28.4 s). A turn
  now keeps the side it started on until it lands. Checkpoint tours were
  not affected.
- **The tour player's travel direction follows the path outside
  checkpoint tours.** It was read along a chord whose two ends fell on the
  same point everywhere except the route's first and last metre, so it came
  out as yaw 0 (+Z). A scene document's `autotour` holds only `target` gaze
  keys, so the only case a document could reach was an eye passing exactly
  through its gaze target away from the route's ends: for that instant the
  look pointed toward +Z. Checkpoint tours steer their own travel look and
  are unchanged.
- **The green field shown while an object is moved reaches the edges and
  narrow places where it fits.** The field judged one pose per point of a
  0.1 m lattice and painted their footprints, so it stopped up to a lattice
  step short of where the legal poses end, and missed places the object
  only just fits when they lay between two lattice points: on the demo flat
  the sofa showed 546 of the 616 floor cells it may cover. The field now
  judges the cell centres, walks from each legal one toward its illegal
  neighbours to the last legal pose and round the field's corners, and
  looks between two neighbours that fail for different reasons, to
  0.025 m: the sofa shows all 616. Across the demo's 50 floor objects
  6,550 cells turned green and 194 turned red, a mask costs about a fifth
  more, and a legal patch only a few centimetres across can still fall
  between the lattice lines.

## [0.1.0] — 2026-10-19

The first public release of JEEX Player (the package name is `jeex-viewer`;
it is not on npm yet and is built from source): an interactive 3D apartment player for the browser, built on
Three.js.

### Added

- **Five view modes.** A 2D plan drawing (`plan2d`) with room names, areas,
  dimension lines and a camera marker; a 3D top view (`plan3d`); a 360
  dollhouse orbit (`orbit`); a first-person walk at eye height with
  collisions (`walk`); and a guided tour along an authored route (`tour`)
  with play, pause, scrubbing, three speeds and scroll-driven seeking.
  Interactive doors that open on approach, a mini-map with click-to-travel,
  interior presets, and finish and furniture-variant panels for editing.
- **Three embed paths with one set of options, handle methods and events.**
  - an ES module, `mountViewer(container, options)`, plus an IIFE build that
    publishes the global `JeexViewer`;
  - the `<jeex-viewer>` custom element, in an open shadow root or in light
    DOM (`shadow="none"`), with `:state()` for loading, ready and error;
  - an iframe: `embed.html` with the `jeex-embed` v1 postMessage protocol
    and the `jeex-viewer/host` helper (`embedViewer`, no Three.js, under
    4 KB gzip), which validates origins, queues commands until ready and
    times out unanswered ones.
- **Paste into any site.** `<jeex-viewer>` has a default box (block, full
  width, 16:9, live `ratio`); the element and `embed.html` are read-only for
  visitors unless `readonly="0"`; `jeex-viewer.iife.js` registers the element
  on load, so a classic `<script>` plus the tag works without inline code;
  `dist-lib/embed.html` is the public frame page, opts into responsive
  iframes and reports its content size (`size` event,
  `embedViewer({ autoHeight: true })`).
- **Scene document**, schema `2.1` (`2.0` is read too): walls on a node
  graph, openings, rooms, furniture placements with mirroring, cameras,
  navigation, tour route and checkpoints, finishes and interior presets.
  Every entity id is a UUID v7. A JSON Schema generated from the types ships
  as `jeex-viewer/schema/scene.json`, with one for the options as
  `jeex-viewer/schema/viewer-options.json`.
- **Baked project format**, `jeex-project` version 2: one folder with a
  `project.json` manifest, the scene, the GLB models, materials and
  previews, loaded from any static host with strict path rules, size limits,
  GLB container checks and credential-free fetches. Variant pricing and
  access metadata are validated and passed through to the host.
- **Handle API.** Mode, room focus, furniture visibility, locale, selection
  and `describeSelection` for host-drawn cards, `getState`, `getScene`,
  `project()`, host slots for the host's own chrome inside the viewport, and
  an asset move, turn and mirror tool for editor hosts.
- **Export and capture.** `exportGlb` (with an element metadata table) and
  `exportUsdz` for iOS Quick Look; stills, equirectangular panoramas and
  before/after pairs, each with a provenance record and, by default, a
  "rendered, not a photograph" caption.
- **Scene operations entry**, `jeex-viewer/ops`: twenty-seven atomic
  operations, a revision model, typed parsing, validation, layout linting
  and the shipped catalogues, with no Three.js and no DOM, for editing a
  document without mounting a player.
- **Theming** through ten custom properties (`THEME_PROPERTIES`), including
  `--jeex-color-scheme` for light and dark chrome, and seven shadow parts
  (`SHELL_PARTS`). The stylesheet lives in cascade layers, so an unlayered
  host rule wins without `!important`.
- **Languages.** Seven catalogues ship: `en`, `de`, `fr`, `it`, `es`,
  `sr-Latn` and `ru`, each complete. The German, French, Italian and Spanish
  ones are machine-translated and have not had a native speaker's review yet.
  Hosts add more with `registerLocale`; BCP-47 tags are accepted.
- **Accessibility.** Keyboard operation of every mode and control with
  visible focus, a modal panel with focus management, screen-reader
  descriptions and a polite live region, `prefers-reduced-motion` support
  (`motion` option), 24×24 px minimum targets, and axe checks with zero
  critical or serious violations on the reference pages.
- **Content Security Policy.** Runs under
  `script-src 'self'; style-src 'self'` with no `unsafe-inline` (styles are
  constructed stylesheets), needs no Trusted Types policy, and loads no
  script at runtime.
- **Errors and logging.** Every failure is a `ViewerLibError` with a stable
  `code`; diagnostics go to an `onLog` sink instead of the console.

## Versioning

This project has not yet reached `1.0`; `0.x` releases may include
breaking changes, called out in this file.

A change to any of the following is a **major** version bump, and — where
the wire protocol itself is affected — also bumps `PROTOCOL_VERSION` in
the embed bridge (`src/embed/protocol.ts`):

- the `CommandMethod` union (adding, removing, or changing the shape of a
  postMessage command the embed bridge accepts);
- the `ErrorCode` union (adding, removing, or renaming an error code
  either side of the bridge can produce);
- the public shape of `ViewerHandle` (removing a method/property, or
  changing an existing one's signature — additions are minor);
- the set or meaning of `ViewerOptions` keys consumed by
  `mountViewer`/`<jeex-viewer>` (removing a key, changing its default, or
  changing what a value means — additions are minor);
- `schemaVersion` on the scene document format.

Not every major bump touches `PROTOCOL_VERSION` — a `ViewerHandle` or
`ViewerOptions` change local to the in-page API, with no postMessage
surface affected, bumps only the package version. Conversely, any
`PROTOCOL_VERSION` bump is always a package major bump, since a host page
embedding via iframe has no other way to detect the incompatibility.
