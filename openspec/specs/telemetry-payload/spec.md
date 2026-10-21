# telemetry-payload Specification

## Purpose
Defines exactly what a telemetry send of the player may contain, so that every field is known in advance, coarse, free of identifiers and checkable by a schema and by tests.

## Requirements

### Requirement: Closed field list per send

Every send SHALL be one JSON object of exactly one group (`lifecycle`, `actions`, `rooms`, `device`, `error`) whose keys are exactly the shared context keys plus that group's keys. A send that does not match its schema SHALL be dropped, never repaired or partially sent.

#### Scenario: Key list of each group is fixed

- **WHEN** the player produces a send of any group
- **THEN** its top-level keys are `schema`, `player`, `embed`, `site`, `page`, `subject`, `lang`, `group` and the keys listed for that group in this spec, and nothing else

#### Scenario: A malformed send is dropped

- **WHEN** a send would carry a value outside its schema (an unknown key, a string where a bucket is expected, an id that is not a UUID)
- **THEN** no request is made for it

### Requirement: Shared context

Every send SHALL carry `schema` (the payload schema semver), `player` (the package version), `embed` (`element`, `iframe` or `script`), `site` (an origin or `null`), `page` (a sanitised path or `null`), `subject` (`project`, `bake`, `scene`, each a UUID or `null`), `lang` (a shipped locale tag or `other`) and `group`.

#### Scenario: Context of a custom element on a page

- **WHEN** `<jeex-viewer>` plays a baked project on `https://agency.example/flats/sea-view?ref=mail`
- **THEN** every send carries `embed: "element"`, `site: "https://agency.example"` and `page: "/flats/sea-view"`, and the sends made after the project (its manifest and its scene) was validated and shown carry its project, bake and scene UUIDs

#### Scenario: View before anything is loaded

- **WHEN** the `view` send leaves at mount, before the scene is fetched
- **THEN** its `subject` is `{ project: null, bake: null, scene: null }`, and the `view` send is not delayed to fill it

#### Scenario: An unshipped locale is not echoed

- **WHEN** the host registered and selected a private-use locale
- **THEN** `lang` is `other`

### Requirement: Page path sanitising

The page path SHALL be the path only: the query and the fragment are always dropped; a segment that is an email (also percent-encoded) or a handle (`@name`), contains a UUID or six or more digits in a row, or contains a run of twenty or more letters and digits, or of twenty or more URL-safe characters with a digit or an underscore, SHALL become `:id`; control characters are percent-encoded; the result is cut to 200 characters.

#### Scenario: Personal segments become :id

- **WHEN** the page is `/users/someone%40example.org/reset/abcdefghij0123456789xyz?token=1#x`
- **THEN** `page` is `/users/:id/reset/:id`

#### Scenario: Slugs and short numbers stay

- **WHEN** the page is `/flats/two-bedroom-flat-with-a-garden-view/12345`
- **THEN** `page` is unchanged

### Requirement: Subject ids are validated UUIDs

`subject` SHALL name the document on screen: `project` and `bake` from its validated baked-project manifest, `scene` from its validated scene; it changes only when a whole document (manifest and scene) has loaded and is shown. Before the first one, and for any value that is not a UUID, members SHALL be `null`. Data gathered for one scene SHALL keep that scene's subject. No tour short id and no scene URL SHALL be sent.

#### Scenario: Load failure keeps the subject on screen

- **WHEN** the first document fails to load, even after its manifest was read and validated
- **THEN** the error send carries `subject` with all three members `null`; a failed `loadScene` later carries the subject of the scene still on screen

#### Scenario: Bare inline scene

- **WHEN** the host mounts an inline scene document with no project
- **THEN** `subject` is `{ project: null, bake: null, scene: <the scene's UUID> }`

### Requirement: Lifecycle group

The `lifecycle` group SHALL carry `event`: `view` (no other key), `ready` with `load` (`<1s`, `1-3s`, `3-10s`, `10-30s`, `>30s`), or `models_loaded` with `load`, `outcome` (`complete`, `partial`, `budget`, `none`), `failed` (capped count) and `assets` (at most 50 sorted, unique asset UUIDs of the project library). Load time runs from the mount, or from the `loadScene` call for a later scene.

#### Scenario: Ready after the first drawn frame

- **WHEN** the first frame of the scene is drawn 2.4 s after the mount
- **THEN** a `lifecycle` send carries `event: "ready"` and `load: "1-3s"`

#### Scenario: Models settle with a failure

- **WHEN** the model pass ends with one model that could not load
- **THEN** a `lifecycle` send carries `event: "models_loaded"`, `outcome: "partial"` and `failed: 1`

#### Scenario: One models_loaded per shown scene

- **WHEN** a scene with no models is shown, then edited so that its geometry is rebuilt
- **THEN** one `models_loaded` with `outcome: "none"` is sent for it, and none for the rebuild

#### Scenario: A replaced scene's pass is not reported

- **WHEN** the host replaces the scene while its models are still loading
- **THEN** no `models_loaded` is sent for the abandoned pass

#### Scenario: Ready means drawn

- **WHEN** a scene is presented while the plan view only draws the 3D scene as a periodic heartbeat
- **THEN** `ready` is sent after the next frame in which the 3D scene was actually rendered

### Requirement: Actions group

The `actions` group SHALL carry `counts`, an object with exactly the keys `mode`, `interior`, `select_furniture`, `select_opening`, `select_wall`, `select_room`, `panel`, `door`, `fullscreen`, `minimap`, `camera_step`, `tour_start`, `tour_complete`, each a whole number from 0 to 50.

#### Scenario: Only accepted actions count

- **WHEN** the player opens in its start mode, a mode button is pressed for the mode already shown, and the tour is sought to its end
- **THEN** `mode` and `tour_complete` stay 0; a later switch to another mode counts 1, and a tour that plays to its end counts 1 for `tour_complete`

#### Scenario: Counters are capped per mount

- **WHEN** a visitor switches modes 70 times during one mount, across several sends
- **THEN** the `mode` counts of all sends of that mount add up to 50

### Requirement: Rooms group

The `rooms` group SHALL carry `rooms`, at most 100 entries sorted by room id, each `{ room, dwell }` where `room` is the scene's room UUID and `dwell` is one of `<5s`, `5-30s`, `30s-2m`, `2-10m`, `>10m`. A room with no time SHALL NOT appear; no order of visits and no position SHALL be sent.

#### Scenario: Dwell is bucketed and unordered

- **WHEN** a visitor walks through room B for 40 s and then room A for 3 s
- **THEN** the send lists A (`<5s`) before B (`30s-2m`) by id, with no other data about the walk

### Requirement: Device group

The `device` group SHALL carry `fps` (the share of drawn time per bucket `<20`, `20-30`, `30-50`, `>50`, each a whole tenth in percent), `gpu` (`low`, `mid`, `high` from WebGL capabilities, or `none`), `width` (`<480`, `480-1024`, `1024-1600`, `>1600`), `input` (`touch` or `pointer`) and `fullscreen` (share of time, whole tenth in percent).

#### Scenario: No renderer string

- **WHEN** a device send is produced on any browser
- **THEN** it contains no GPU vendor or renderer string, no screen size and no user-agent string

### Requirement: Error group

The `error` group SHALL carry `code` (`network`, `scene_format`, `manifest_format`, `model_format`, `webgl_unavailable`, `context_lost`, `size_limit`, `exception`, `rejection`, `other`), `stage` (`scene_load`, `model_load`, `capture`, `mode`, `tour`, `embed`, `bridge`, `runtime`), `name` (a standard error class name or `Error`), `frames`, `browser` and `count` (1 to 50).

#### Scenario: Message text never leaves

- **WHEN** the player throws `new TypeError("cannot read x of https://site.example/?email=a@b.example")` in its own code
- **THEN** the error send carries `name: "TypeError"` and no part of the message

#### Scenario: Non-standard error names are not echoed

- **WHEN** the error's `name` was set to free text
- **THEN** the send carries `name: "Error"`

### Requirement: Error frames are the player's own

`frames` SHALL hold at most 5 of the topmost stack frames in the player's own published files, each `{ file, line, column }` with the bare file name; other files, `eval`, `blob:` and `data:` frames are dropped. An `exception`, `rejection` or `other` error with no own frame SHALL NOT be sent. The other codes are raised by the player's own checks and are the player's by construction; they carry an empty `frames`.

#### Scenario: Every stack code needs an own frame

- **WHEN** an error of code `exception`, `rejection` or `other` has no frame in the player's files
- **THEN** it is not sent, while a `network`, format, size, WebGL or context error is sent with `frames: []`

#### Scenario: A site error is not reported

- **WHEN** a script of the embedding site throws and the page-wide error listener sees it
- **THEN** no error send is made

#### Scenario: A bundled player fails closed

- **WHEN** the player is bundled into a site's own script file whose name is not a published player file name
- **THEN** no frame counts as the player's own and exceptions are not reported

### Requirement: Browser bucket

`browser` SHALL be the browser family and a bucketed major version (`chromium-13x`, `firefox-14x`, `safari-26`, or `other`) derived in the browser from client hints or the user-agent string; the string itself SHALL NOT be sent.

#### Scenario: Chromium by client hints

- **WHEN** client hints report the `Chromium` brand at version 137
- **THEN** `browser` is `chromium-13x`

### Requirement: Never sent

No send SHALL contain an IP address, a user-agent string, a GPU renderer string, a visitor or visit identifier, camera coordinates or a camera path, an order of events, a client timestamp, a query string or fragment, an error message or raw stack, anything read from cookies or storage, or page form data.

#### Scenario: Every send passes the never-list walk

- **WHEN** every send of a full session (mount, modes, walk, tour, errors, flushes) is collected
- **THEN** no key outside the closed lists appears and every string value is a vocabulary member, a bucket, a version, an origin, a sanitised path, a UUID or an own file name
