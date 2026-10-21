# Proposal

## Why

The player runs on sites we do not control, and nothing tells us how it behaves there: how long the first frame takes, which modes and features are used, on what kind of device, and where it breaks. Improving the player needs that knowledge, and it must be gathered in a way that provably identifies nobody, needs no consent banner and can be switched off completely by a site or by the visitor's browser.

## What Changes

- **New, on by default:** the player sends anonymous telemetry to `https://telemetry.jeex.org/v1/player`: lifecycle (`view`, `ready`, `models_loaded`), capped action counters, room dwell buckets, coarse device buckets and player error reports, each group as its own request with a closed, schema-checked field list.
- **New option** `analytics` (`mode: 'on' | 'off'`, `endpoint`), spelled `analytics="off"` / `analytics-endpoint="…"` on `<jeex-viewer>`, `?analytics=off` / `?analyticsEndpoint=…` on the iframe page (and therefore as `embedViewer` option keys), and `{ analytics: { mode: 'off' } }` for `mountViewer`. `off` and Global Privacy Control make the player send nothing at all.
- **New embed protocol command** `context` (host to frame, one-way): the host helper hands the frame its page path after the frame loads, so iframe sends can name the page without the path ever appearing in a URL.
- **New documents:** `TELEMETRY.md` (what is sent, with examples; what is never sent; how to turn it off; where it goes), `telemetry.schema.json` generated from the schemas, a telemetry page on the player site, a README section and a CHANGELOG entry.
- Default-on telemetry is a behaviour change for every embedding site: a site with a Content Security Policy needs the endpoint in `connect-src` (otherwise sends fail silently), and test suites of embedding applications should intercept the endpoint or set `analytics="off"`.

## Capabilities

### New Capabilities

- `telemetry-payload`: what a telemetry send may contain: the shared context, the five send groups, the vocabularies and buckets, path sanitising, error reports and the fields that are never sent.
- `telemetry-delivery`: when and how sends leave: the request shape, the flush triggers, deduplication and caps, failure handling, and the page-wide error listeners.
- `telemetry-controls`: how a site or a visitor's browser turns telemetry off or redirects it, and how the iframe page learns its host page.

### Modified Capabilities

None (no capability specs exist in this repository yet).

## Impact

- New layer `src/telemetry/` (pure modules plus the transport) and `src/app/telemetry-wiring.ts`; one call in the composition root; small signals added to the scene mount (model pass outcome), the stage (first drawn frame) and the UI command paths (actions).
- Options: two new rows in the options table and the options schema; `viewer-options.ts` replaces its five exhaustiveness checks with one generic helper in `option-sets.ts` to stay under its line limit.
- Embed: `context` command in the protocol and the frame bridge; the host helper posts it on the frame's `load` (the helper stays under its 4 KB budget); `mountViewer` gains an internal embed-form-aware sibling used by the element and the frame page.
- Tests: unit tests per module, a Playwright spec with request interception, and a host-resolver rule in the shared headless browser launch so no test reaches the production endpoint.
- No new dependencies. The JSON Schema generator runs only in a script and a test, never in a bundle.
