# Tasks

Tests first in every group (`bun test <file>` red, then green). Inner loop: `bash scripts/check.sh fast`.

## 1. Layer and pure modules

- [x] 1.1 Add the `telemetry` layer between `ui` and `app` in `.dependency-cruiser.cjs`; verify `bun run check:arch` is green and a deliberate upward import from `src/telemetry/` is refused.
- [x] 1.2 `page-path.ts` with tests for query/fragment removal, email (raw and percent-encoded), UUID, six-digit runs, twenty-character runs, slugs kept, length cut, control characters; verify `bun test src/telemetry/page-path.test.ts`.
- [x] 1.3 `buckets.ts` (dwell, load, fps, width, share, capped count) with edge tests; verify its test file.
- [x] 1.4 `stack-frames.ts` (Chrome, Firefox, Safari formats, message line never read, eval/blob dropped, top 5) and the browser bucket; verify its test file.
- [x] 1.5 `vocabulary.ts` closed sets (each union is derived from its list, so no separate drift row is needed); `telemetry.schema.ts` (closed objects, bounded arrays, endpoint check) listed in `SCHEMA_MODULES`; tests: each group's exact key list, rejection of an extra key, a non-UUID id, a non-bucket string, an over-long array; endpoint accepted/refused cases; verify `bun test src/telemetry/telemetry.schema.test.ts src/purity.test.ts`.
- [x] 1.6 `own-files.ts` and `error-report.ts`: own-frame predicate (same directory and published name shape, fail closed for an unpublished own name), name allowlist, code/stage mapping, dedupe key, and a test over every code: `exception`, `rejection`, `other` without an own frame give no report, every other code gives one with `frames: []`; verify their test files.

## 2. Collector, transport, telemetry object

- [x] 2.1 `collector.ts`: lifetime-capped counters (70 increments across three snapshots sum to 50), room dwell (UUID rooms only, at most 100, sorted, unvisited absent), frame-time histogram (long intervals dropped, time-weighted shares), fullscreen share, errors (dedupe into `count`, at most 10 error sends over the mount across snapshots); `snapshot()` resets synchronously; verify its test file.
- [x] 2.2 `transport.ts`: the exact `fetch` init (spy on `globalThis.fetch`), JSON string body without headers, swallowing a rejection, a synchronous throw and a missing `fetch`; verify its test file.
- [x] 2.3 `device.ts`: GPU class from a stub context (WebGL 1, small and large limits, float extension), input type, width bucket; verify its test file.
- [x] 2.4 `telemetry.ts`: off and GPC create nothing and send nothing through mount, count, error, timer, hidden, pagehide and dispose, with an enabled positive control; `view` immediately; flush builds one request per group and per error; a send failing its schema is dropped; overlapping hidden + pagehide send once; scene replacement flushes with the old subject; page-wide listeners installed once for two instances and an error routed once; verify its test file.
- [x] 2.5 The never-list walk: run a full scripted session through `telemetry.ts` with a spied `fetch`, collect every body, assert closed keys and that every string value belongs to its vocabulary; verify the test.

## 3. Options and embed forms

- [x] 3.1 Replace the five exhaustiveness checks in `viewer-options.ts` with a `closedSet<Union>()` helper in `option-sets.ts` (no type import back into `viewer-options.ts`); verify a missing member still fails `tsc`, `bun run check:arch` has no cycle, and `bun test src/app` is green.
- [x] 3.2 Add `analytics.mode` and `analytics.endpoint` (option kind `endpoint`) to `ViewerOptions`, defaults, `OptionPath`, `OPTION_SCHEMA`, the resolver and `viewer-options.schema.ts` with the agreement check; tests: attribute, query and object spellings, invalid mode falls back to `on`, an invalid or non-string endpoint resolves to `''` with exactly one warning; verify `bun test src/app/viewer-options.test.ts src/app/viewer-options.schema.test.ts` and that the generated options JSON Schema still validates the fixtures.
- [x] 3.3 `mountViewerAs` in `viewer-api.ts` used by `element.ts` (`element`) and `frame-boot.ts` (`iframe`), `mountViewer` = `script`; verify by a test per form that the `embed` field of the `view` send matches.
- [x] 3.4 Protocol `context` command (method list, params schema, not-ready exemption, bridge handling with `FrameSite`), frame `site` from `ancestorOrigins` or the first accepted message; tests in `protocol.schema.test.ts` and `frame-bridge.test.ts` including a foreign source and a foreign origin; verify those files.
- [x] 3.5 Host helper posts `context` on the frame's `load` with `location.pathname`, never in the frame URL; test in `host.test.ts`; verify `bun run build:lib && bun run check:budget:lib` keeps the host under 4 KB and record the byte cost.

## 4. Wiring into the viewer

- [x] 4.1 `shared/usage.ts` (`UsageAction`, `UsageSink`) and the call at each acceptance point (editor preset commit and panel open, door toggle, mini-map navigation, accepted camera step, fullscreen entered; select kinds from the `select` event; mode from the `mode` event after the first `ready` and only on a real change; tour start from `state`; tour completion from a new `onComplete` raised only by `TourPlayer.update()` reaching the end); tests: start-up mode and a same-mode press count 0, a seek to the end does not count `tour_complete` and a played end does (`tour-player.test.ts`), the other points in their collaborators' existing test files.
- [x] 4.2 `SceneBuilder.upgradeModels` result gains `budget` and `failures`; `SceneMount` reports the first, unaborted pass of each mounted or presented document through `onModelsSettled`; `RenderRuntime` gains `lastDrawnAt`; tests: budget stop, no-model scene (`none`), a rebuild pass not reported, an aborted pass (scene replaced mid-pass) not reported, `lastDrawnAt` unchanged on a heartbeat-skipped frame; verify their test files.
- [x] 4.3 `app/telemetry-wiring.ts`: subscriptions, post-render hook for the first drawn frame (`lastDrawnAt === now`), frame time and rooms, subject from the validated document and manifest, attach per boot, flush before `loadScene` presents (pending `models_loaded` with its own subject); keep `viewer-app.ts` at or under 500 lines by moving a responsibility out; tests: immediate `view` with a null subject, a first-load failure after a valid manifest with a null subject, a failed later `loadScene` with the subject still on screen, `ready` with the ids, a models-only flush, a scene replacement that keeps the old subject on old data; verify `bun test src/app` and the file-size check.
- [x] 4.4 Test isolation: host-resolver rule in `tests/headless-webgl.ts`; Playwright spec `tests/e2e/telemetry.spec.ts` with request interception: `view` and `ready` arrive with the right keys for the element and the iframe page (the iframe's later sends carry the host page path from `context`), zero requests with `analytics="off"` and with GPC (`navigator.globalPrivacyControl` defined by an init script), positive control in the same spec; verify `bunx playwright test tests/e2e/telemetry.spec.ts`.
- [x] 4.5 Check that the IIFE build's `import.meta.url` resolves to the script URL (built `dist-lib/jeex-viewer.iife.js` inspected by a test over the artefact or a browser assertion in the e2e spec); verify the test.

## 5. Documentation

- [x] 5.1 `scripts/telemetry-schema.ts` writes `telemetry.schema.json`; drift test `scripts/telemetry-schema.test.ts`; verify `bun test scripts/telemetry-schema.test.ts`.
- [x] 5.2 `TELEMETRY.md` (why, every field with an example per group, the never-list, what the receiver can still observe, anonymised and product-improvement-only, never sold or linked to people, how to turn off, CSP `connect-src`, where it goes, schema link); README "Telemetry" section of 2-3 lines that names `analytics="off"`, GPC and the CSP `connect-src` requirement; `package.json` `files` and the `./schema/telemetry.json` export; CHANGELOG entry; verify `bash scripts/no-docs-refs.sh`, `bun run check:pkg` and the docs-key test.
- [x] 5.3 `site/telemetry.html` and `telemetry.schema.json` published by `scripts/site-build.ts`, the page linked from the site's pages where the others are linked; tests: every schema key appears in `TELEMETRY.md` and the page, the site build output contains the page and the schema file its link names; verify `bun test scripts/site-build.test.ts` and the new test.
- [x] 5.4 Size cost: compare `dist` and `dist-lib` gzip sizes with the base and record them in the report; verify `bun run check:budget` and `bun run check:budget:lib` are green.

## 6. Integration

- [x] 6.1 One full quality gate (`scripts/check.sh full`) on the final tree; on red, re-run only the failed files; at most two full gates.

## Workflow follow-up

- Archive the change and run `openspec validate --all --strict`.
