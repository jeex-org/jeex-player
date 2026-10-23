# Changelog

All notable changes to this project are documented in this file. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
as described under [Versioning](#versioning).

## [Unreleased]

### Added

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

- **The sun respects the apartment.** Its shadow is fitted to the walls,
  ceilings, floors, furniture and door swings of the scene on screen (no more
  fixed square that clipped large plans and wasted the map on small ones),
  and drawn only when something that casts or receives changed. Ceilings
  block the sun in every view and walls cut away by the overview keep their
  shadow, so in an overview sunlight reaches the floors only through windows
  and doors. Scenes look different where light used to fall through the
  missing ceilings: that is intended.

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
