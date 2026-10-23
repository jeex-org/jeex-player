# Telemetry

The JEEX player sends a small amount of anonymous data about how it runs, so that we can make it faster, fix its errors and see which of its features are used, and on which sites. This page lists everything it sends. Nothing else leaves the player.

The data is anonymous and is used only to improve the player. It is never sold, never used for advertising and never linked to people.

## How to turn it off

- On the element: `<jeex-viewer analytics="off">`. It fails closed: only a missing attribute or exactly `on` sends; any other value turns it off.
- On the iframe page: `embed.html?analytics=off`, or `analytics: 'off'` in `embedViewer(...)`.
- In code: `mountViewer(el, { analytics: { mode: 'off' } })`.
- A visitor whose browser sends [Global Privacy Control](https://globalprivacycontrol.org/) (`navigator.globalPrivacyControl === true`) is never counted.

Off means no request at all. Everything else the player does is unchanged: it still loads its scene and models from wherever they are served.

`analytics-endpoint` (`?analyticsEndpoint=`, `analytics.endpoint`) sends the same data to another address instead: an `https:` URL, or `http:` on `localhost`/`127.0.0.1`. Any other value turns telemetry off.

## Where it goes

Every request is a `POST` of one JSON object to `https://telemetry.jeex.org/v1/player`, made with `fetch` and `keepalive`, without credentials (`credentials: 'omit'`), without a referrer (`referrerPolicy: 'no-referrer'`), without custom headers and without retries. A failed request is ignored. A site with a Content Security Policy must allow the endpoint in `connect-src`; otherwise the requests are refused silently.

Like any web request, a request reaches the server with the visitor's IP address and the browser's standard headers. The player cannot remove them; the player itself never sends them in the body, and the receiving server's own policy covers what it keeps of them.

## What is never sent

No cookies and nothing read from or written to any browser storage. No visitor or visit identifier, not even a temporary one: two requests of the same visit share no field beyond the shared context below. No user-agent string, no GPU vendor or renderer string, no fonts, no screen size, no time zone. No camera position, no path through the apartment, no order of events, no timestamps. No query string or fragment of the page address. No error message and no raw stack. No form data or other content of the page.

## What is sent

Each request belongs to one group (`group`) and carries the shared context. Every field of every request is in the tables below; a field that is not in them is never sent.

### Shared context

| Field | Meaning | Example |
|---|---|---|
| `schema` | version of this payload format | `"1.0.0"` |
| `player` | version of the player | `"0.1.0"` |
| `embed` | how the player is embedded: `element`, `iframe` or `script` | `"element"` |
| `site` | origin of the page; for the iframe page, the embedding page's origin as the browser reports it or as the host's verified messages prove it; `null` when not known | `"https://agency.example"` |
| `page` | path of the page without query and fragment; a segment that looks like an email, a handle, a UUID, a token or a long number becomes `:id`; at most 200 characters; `null` when not known | `"/flats/:id"` |
| `subject` | what is played: the three ids below | `{"project": "0192…", "bake": "0192…", "scene": "0192…"}` |
| `lang` | language of the player's interface: `en`, `de`, `fr`, `it`, `es`, `sr-Latn`, `ru`, or `other` | `"en"` |
| `group` | which group the request belongs to: `lifecycle`, `actions`, `rooms`, `device`, `error` | `"lifecycle"` |

`subject`, each a UUID of the document on screen, or `null` when not known:

| Field | Meaning | Example |
|---|---|---|
| `project` | the baked project | `"0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e51"` |
| `bake` | this bake of the project | `"0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e52"` |
| `scene` | the scene document | `"0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e53"` |

### `lifecycle`

| Field | Meaning | Example |
|---|---|---|
| `event` | `view` (the player mounted), `ready` (the first frame was drawn), `models_loaded` (the 3D models finished loading) | `"ready"` |
| `load` | `ready` and `models_loaded`: time since the mount or the scene change: `<1s`, `1-3s`, `3-10s`, `10-30s`, `>30s` | `"1-3s"` |
| `outcome` | `models_loaded`: `complete`, `partial` (some failed), `budget` (stopped by the size limit), `none` (nothing to load) | `"complete"` |
| `failed` | `models_loaded`: models that could not load, at most 50 | `0` |
| `assets` | `models_loaded`: UUIDs of the project's library assets, at most 50 | `["0192…"]` |

`view` and `ready` are sent at once (the iframe page waits up to 2 seconds for its host to name the page first); everything else is sent when the page is hidden or closed, every 5 minutes, and when the scene changes.

### `actions`

| Field | Meaning | Example |
|---|---|---|
| `counts` | how often each action below was done since the last request; each at most 50 over the whole view | `{"mode": 3, "door": 1, …}` |

The actions in `counts`:

| Field | Meaning | Example |
|---|---|---|
| `mode` | the view mode changed (not the start mode) | `3` |
| `interior` | an interior style was applied | `0` |
| `select_furniture` | a piece of furniture was selected (when the site enables selection) | `0` |
| `select_opening` | a door or window was selected | `0` |
| `select_wall` | a wall was selected | `0` |
| `select_room` | a room was selected | `0` |
| `panel` | a selection panel was opened | `1` |
| `door` | a door was opened or shut | `1` |
| `fullscreen` | fullscreen was entered | `0` |
| `minimap` | the mini-map was used to move | `2` |
| `camera_step` | the camera stepped to a tour camera | `4` |
| `tour_start` | the tour started | `1` |
| `tour_complete` | the tour played to its end | `0` |

### `rooms`

| Field | Meaning | Example |
|---|---|---|
| `rooms` | the rooms the camera was in during a walk or a tour, sorted by room id, never in visit order, at most 100 | `[{"room": "0192…", "dwell": "30s-2m"}]` |
| `room` | the room's UUID from the scene | `"0192f5c4-7a1b-7c3d-8e9f-0a1b2c3d4e54"` |
| `dwell` | time spent there: `<5s`, `5-30s`, `30s-2m`, `2-10m`, `>10m` | `"30s-2m"` |

### `device`

| Field | Meaning | Example |
|---|---|---|
| `fps` | share of drawn time per frame-rate range, measured between two consecutive drawn frames (a view at rest in walk or tour draws nothing and adds nothing), in whole tenths of percent | `{"<20": 0, "20-30": 10, "30-50": 30, ">50": 60}` |
| `<20` | share below 20 frames per second | `0` |
| `20-30` | share from 20 to 30 | `10` |
| `30-50` | share from 30 to 50 | `30` |
| `>50` | share above 50 | `60` |
| `gpu` | capability class from what WebGL supports (texture size, multisampling, float colour buffers), not a performance ranking: `low`, `mid`, `high`, `none` | `"mid"` |
| `width` | width of the player: `<480`, `480-1024`, `1024-1600`, `>1600` | `"1024-1600"` |
| `input` | `touch` or `pointer` | `"pointer"` |
| `fullscreen` | share of drawn time in fullscreen, in whole tenths of percent | `0` |

### `error`

One request per distinct error, at most 10 per view; repeats of the same error are counted, not sent again.

| Field | Meaning | Example |
|---|---|---|
| `code` | `network`, `scene_format`, `manifest_format`, `model_format`, `webgl_unavailable`, `context_lost`, `size_limit`, `exception`, `rejection`, `other` | `"network"` |
| `stage` | `scene_load`, `model_load`, `capture`, `mode`, `tour`, `embed`, `bridge`, `runtime` | `"scene_load"` |
| `name` | standard class name of the error, otherwise `Error`: `Error`, `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `EvalError`, `URIError`, `AggregateError`, `InternalError`, `ViewerLibError`, `SceneValidationError`, `AbortError`, `NetworkError`, `NotSupportedError`, `NotAllowedError`, `InvalidStateError`, `SecurityError`, `QuotaExceededError`, `DataCloneError`, `EncodingError`, `TimeoutError`, `OperationError`, `UnknownError` | `"TypeError"` |
| `frames` | up to 5 top stack frames in the player's own published files only | `[{"file": "jeex-viewer.iife.js", "line": 1, "column": 52310}]` |
| `file` | the frame's file name, without its directory, query or fragment | `"jeex-viewer.iife.js"` |
| `line` | the frame's line | `1` |
| `column` | the frame's column | `52310` |
| `browser` | browser family and major version range | `"chromium-14x"` |
| `count` | how often it happened since the last request, 1 to 50 | `2` |

An exception whose stack has no frame in the player's own files (the site's code, a browser extension, or a player bundled into a site's own script) is not reported at all.

## Schema

[`telemetry.schema.json`](telemetry.schema.json) is the exact JSON Schema of every request body, generated from the schema the player checks each request against before it is sent. It is also published at `https://player.jeex.org/schema/telemetry/1.0.0.json` and in the package as `jeex-viewer/schema/telemetry.json`. Any change to these fields changes the schema version and is listed in [CHANGELOG.md](CHANGELOG.md).
