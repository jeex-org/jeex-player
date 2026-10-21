# Design

## Context

See `proposal.md` for the motivation and `specs/` for the behaviour. The constraints that shape the code:

1. The source tree is layered and the order is enforced (`.dependency-cruiser.cjs`): a module imports only its own layer or a lower one. `zod/mini` is importable only from `*.schema.ts` files listed in `src/purity.test.ts`.
2. `src/app/viewer-app.ts` (the composition root) is at its 500-line limit and `src/app/viewer-options.ts` at 692 of 700; a limit is met by moving a responsibility out, never by raising it.
3. The host helper `src/embed/host.ts` has a hard 4 KB gzip budget (about 3.3 KB today) and carries no Zod.
4. Every `addEventListener` carries `{ signal }`; nothing writes to the console except the logger sinks; every throw is a coded `ViewerLibError`; a symbol is exported only when another module imports it.
5. The render loop runs every animation frame while the canvas can be seen; frame hooks receive a delta clamped to 50 ms and the raw `now`; post-render hooks run after the render, also in `plan2d`, where the 3D scene is drawn only as a keep-warm heartbeat.
6. `ready` is emitted one animation frame after the mount, before that frame is rendered; GLB models are upgraded afterwards by `SceneMount.scheduleUpgrade` through `SceneBuilder.upgradeModels`, which reports only counts today.

## Goals / Non-Goals

**Goals:**

1. One telemetry pipeline for all three embed forms, attached in one place.
2. Every send judged by a closed schema right before it is serialised.
3. Zero work, zero listeners and zero requests when telemetry is off.
4. No growth of the boot bundle beyond a few kilobytes gzip, no growth of `ops`, and the host helper under 4 KB.

**Non-Goals:**

1. The receiver, storage, retention and any server-side counting.
2. Showing statistics anywhere.
3. Any change to the scene, manifest or model requests.

## Decisions

### 1. A `telemetry` layer below `app`

`telemetry` is inserted into `LAYERS` between `ui` and `app`. It contains:

| Module | Responsibility |
|---|---|
| `telemetry.schema.ts` | `zod/mini` schemas: the context and one closed object per group, bounded arrays, enums from `vocabulary.ts`; the endpoint override check |
| `vocabulary.ts` | the closed sets (groups, embed forms, codes, stages, counter keys, error names, schema version) |
| `page-path.ts`, `buckets.ts`, `stack-frames.ts` | pure sanitising, bucketing, stack parsing and the browser bucket |
| `own-files.ts` | the player's own file URL (`import.meta.url`) and the own-frame predicate |
| `error-report.ts` | an error to `{ code, stage, name, frames }` or `null`; the dedupe key |
| `collector.ts` | per-mount accumulators: lifetime-capped counters, room dwell, frame-time histogram, fullscreen time, errors; `snapshot()` takes and resets synchronously |
| `transport.ts` | the one `fetch` call with the fixed init; swallows everything |
| `device.ts` | GPU class from a WebGL context, input type, width bucket |
| `telemetry.ts` | the per-mount object: decides on/off, owns the collector, the flush triggers, the timer and the page-wide error listener registration; builds sends, validates, dispatches |

`src/app/telemetry-wiring.ts` is the only module that knows `ViewerEvents`, `TourEvents`, the stage and the scene mount: it projects them into plain calls (`telemetry.count('mode')`, `telemetry.drawn(now, mode)`, `telemetry.room(id)`). Alternative rejected: putting the wiring inside the telemetry layer would make it import `app` types upwards.

### 2. Usage signals travel through one sink

A `UsageSink` type and the closed `UsageAction` vocabulary live in `shared/usage.ts` (lowest layer), so `ui`, `camera` and `app` collaborators can report an accepted action without knowing telemetry. The collaborators that already own each action call it once at the point of acceptance: the editor (interior preset committed, panel opened), the door controller (toggle), the stage wiring (mini-map room navigation, accepted camera step), the fullscreen controller change callback (entering only). Mode changes come from the `mode` event and count only after the first `ready` (the start view sets the mode during boot) and only when the mode differs from the previous one. Tour start is a `state` transition into `playing` from `ready` or `ended`. Tour completion needs its own cause: `TourPlayer` reaches `ended` both by playing to the end and by a seek to the end of a playing tour, so the natural end in `update()` calls a new optional `onComplete` callback that only the playback path raises. Alternative rejected: new public events for each action would grow the public contract for an internal need.

### 3. Missing signals added narrowly

1. **First drawn frame:** post-render hooks also run when the `plan2d` heartbeat skipped the render, so `RenderRuntime` gains a read-only `lastDrawnAt` (the `now` of the last frame it actually rendered). The wiring's post-render hook marks `ready` for the presented scene on the first call where `lastDrawnAt === now` after the document was presented. The load time starts at the mount (first scene) or at the `loadScene` call.
2. **Model pass outcome:** `SceneBuilder.upgradeModels` returns `{ upgraded, failed, budget, failures }` (`budget` true when the byte budget stopped it, `failures` the first few caught errors). `SceneMount` reports it through a new optional `onModelsSettled(model, result)` dependency only for the FIRST pass of a mounted or presented document, and only when that pass was not aborted; passes after an edit or a rebuild are not reported. `outcome` is `none` when no placement had a model to load, `budget` when stopped, `partial` with failures, else `complete`. `assets` are the sorted, unique asset ids of the project library (empty for a bare scene), cut to 50. The pending `models_loaded` is held with the subject of its scene and leaves with the next flush; a scene replacement flushes it with that subject.
3. **Errors:** the viewer's `error` event (codes mapped: `scene-load` to `network` or the format codes by the cause, `scene-invalid` to `scene_format`, `project-invalid` to `manifest_format`, `webgl-unavailable`, `context-lost`, `internal` to `exception` with frames), model failures from the pass outcome (`model_load` stage, `network` for a `TypeError` from `fetch`, else `model_format`), frame-hook errors (`runtime`), and the page-wide listeners (own frames only).

### 4. Embed form and context

`viewer-api.ts` gains an internal `mountViewerAs(embed, container, options, site?)`; `mountViewer` calls it with `script`, `element.ts` with `element`, `frame-boot.ts` with `iframe` and a `FrameSite` object that the bridge updates. The embed form is not an option: a host cannot claim another form.

`FrameSite` holds `site` and `page`: `site` starts as `location.ancestorOrigins?.[0] ?? null`, is set to the bridge's host origin on the first accepted message if still `null`; `page` is set once from the first accepted `context` command. Sends read it at build time, so the `view` send carries what was known at mount.

### 5. The `context` command

A new command method `context` with params `{ page: string }` (at most 2048 characters), exempt from the not-ready rule, answered with an empty success. The host helper posts it once, raw through `postMessage(commandMessage(viewerId, 'context', 'context', { page: location.pathname }), frameOrigin)` from a `load` listener on the iframe (bound to the helper's transport signal); the reply matches no pending command and is ignored. Alternative rejected: a param on the frame URL would write the unsanitised path into the frame server's access logs.

### 6. Options

`viewer-options.ts` first frees lines without a cycle: the five exhaustiveness checks of its closed sets (a type alias and an immediately-invoked function each) become one call each of a generic `closedSet<Union>()(list)` helper in `option-sets.ts`, which imports no type of `viewer-options.ts`; the sets stay beside their unions. Then `analytics: { mode: 'on' | 'off'; endpoint?: string }` is added to `ViewerOptions`, `DEFAULT_VIEWER_OPTIONS` (`mode: 'on'`), `OptionPath`, `OPTION_SCHEMA` and the options schema with its agreement check. `analytics.endpoint` gets its own option kind `endpoint`: the judge is the telemetry endpoint check, and an invalid value (also a non-string one) resolves to the empty string with the usual one `option-invalid` warning, never to `undefined`; telemetry treats any endpoint that fails the check as off. `undefined` means the default endpoint.

### 7. Own files

`own-files.ts` reads `import.meta.url` once. The Vite library build rewrites it in the IIFE bundle to the script URL captured at evaluation; the ES chunks keep the real URL; the test harness under Bun gives a `file:` URL. The predicate accepts a frame URL when it is in the same directory and its name matches `^(lazy-)?jeex-viewer[\w.-]*\.js$`, and only when the player's own file name matches the same shape; otherwise nothing is own. The IIFE build has no `import.meta` (the value is undefined there), so the module falls back to `document.currentScript.src`, read synchronously while the bundle evaluates. The app build (the demo and the hosted `embed.html`) names its entry and chunk files `jeex-viewer-…` / `lazy-jeex-viewer-…` for the same reason. The built IIFE and ES files are checked in a test over `dist-lib` names in the library build step's existing artefact checks where present, and by a unit test of the predicate.

### 8. Frame time and rooms

The post-render hook keeps the previous raw `now`; an interval longer than 1000 ms (hidden tab, off-screen) is dropped and starts a new run. Intervals are added to the bucket of `1000 / interval` fps by their duration, only while the mode is a 3D mode. Every 1000 ms of accumulated drawn time in `walk` or `tour`, the camera position is mapped to a room with the solved plan's `roomOf`; the elapsed time goes to that room if its id is a UUID. Fullscreen time is accumulated from the same intervals.

### 9. GPU class

From the stage renderer's WebGL context at attach time: `low` when `MAX_TEXTURE_SIZE` < 8192 or the context is WebGL 1; `high` when `MAX_TEXTURE_SIZE` ≥ 16384, `MAX_SAMPLES` ≥ 4 and `EXT_color_buffer_float` is supported; `mid` otherwise; `none` without a context. It is a capability class and is documented as such.

### 10. Flush and dispatch

A `loadScene` whose document has the scene id already on screen (an editor host answering an edit with the whole document) is not a new load: no flush, no second `ready`. A model pass that settles before `ready` sets the subject from the settled document itself. `telemetry.ts` builds each group from a synchronous `collector.snapshot()`, wraps it with the context, judges it with `isTelemetrySend` from `telemetry.schema.ts` (the only module that imports Zod), drops it on failure, re-checks `off`/GPC and calls the transport. At most 10 error sends leave over the whole mount: the collector hands over errors only while that allowance lasts. Triggers: `visibilitychange` (hidden) and `pagehide` on the player's document, a 5-minute `setInterval`, the wiring's scene-replacement hook (before the new subject is set) and dispose. Listeners carry the mount's abort signal; the interval is cleared on dispose.

### 11. Page-wide error listeners

A module-level registry in `telemetry.ts` keeps the live telemetry instances in mount order; the first registration installs `error` and `unhandledrejection` listeners on `window` with an abort controller the last unregistration aborts. An event is classified once and handed to the oldest live instance.

### 12. Schema publication

`scripts/telemetry-schema.ts` converts the send schema with Zod's `toJSONSchema` into `telemetry.schema.json` at the repository root; `scripts/telemetry-schema.test.ts` regenerates in memory and fails on a difference. Distribution: the repository root (`TELEMETRY.md` links `telemetry.schema.json`), the npm package (`package.json` `files` gains both), the library build (`build:lib` copies the schema to `dist-lib/schema/telemetry.schema.json`, exported as `jeex-viewer/schema/telemetry.json`), and the player site (`site/telemetry.html`, hand-written with the same content as `TELEMETRY.md`, and `telemetry.schema.json` beside it, both published by `scripts/site-build.ts`). A test checks that every key name of the schema appears in both documents and that the site build output holds the page and the schema its link names.

### 13. Test isolation

`tests/headless-webgl.ts` adds `--host-resolver-rules=MAP telemetry.jeex.org ~NOTFOUND` to the shared Chromium launch, so no component or e2e test can reach the production endpoint; specs that assert sends use request interception, which runs before resolution.

### 14. What `subject` deliberately leaves out

A tour's short link id is not sent: the player never receives one through any of its inputs (a scene URL is opaque to it), and the id of a short tour link is a share secret that would turn an anonymous count into a pointer to one tour link. The receiver relates a bake to its tours on its own side. The scene URL is not sent either.

### 15. Off fails closed, and the iframe page waits for its host

`analytics.mode` is resolved by its own option kind: only an absent value or exactly `on` is on; `off`, `false` and every other value (`OFF`, `none`, `null`, an empty attribute, a typo) are off, so a misspelt switch can never send. `analytics: 'off'` is shorthand for `{ mode: 'off' }`. The host helper applies the same rule to whatever `analytics` it is given and forwards `analytics=off`, so no spelling is lost on the way into the frame. The iframe page holds `view` and `ready` until the host's `context` arrives (at most 2 seconds, or the first flush), so both carry the host page and the verified site.

### 16. Development pages and the agent check send nothing

Every page under `dev/` mounts with `analytics: 'off'` except `dev/telemetry.html`, which exists to test it, and the agent-facing browser check adds `analytics=off` to every page it opens. The test browsers additionally resolve the telemetry host to nothing.

## Risks / Trade-offs

1. [Anonymity is overstated] → `TELEMETRY.md` says what the receiver can still observe (the IP address and browser headers of any request) and that the player cannot remove them; it claims only what the player sends.
2. [Allowed strings carry data: paths, origins, ids] → sanitiser plus UUID-only ids plus vocabulary checks; documented residual risk for tiny sites.
3. [`import.meta.url` differs between bundle forms] → fail closed when the own file name is not a published name; the IIFE rewrite is checked after the library build.
4. [Default-on surprises integrators and their CSP] → README and CHANGELOG say it; failures are silent by design.
5. [Measurements misread (fps of a heartbeat, dwell in orbit)] → only 3D modes count, only walk and tour count rooms.
6. [Host helper over budget] → the context post is a few lines; `check:budget:lib` measures it.
7. [Keepalive bodies over the 64 KiB aggregate] → bounded arrays keep every send well under 8 KiB.

## Migration Plan

None for data. Integrators who want no telemetry set `analytics="off"`. Rollback is a release without the layer.
