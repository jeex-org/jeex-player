# Changelog

All notable changes to this project are documented in this file. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
as described under [Versioning](#versioning).

## [Unreleased]

### Changed

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
