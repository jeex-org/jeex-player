# Proposal

## Why

The player's first frame blocks the main thread for 420–490 ms on a desktop and about 1.6–1.8 s on a throttled phone, mostly waiting for shaders to link at the first draw. Pages that embed the player pay it as blocking time.

## What Changes

- Before the first visible frame the player compiles the scene's shaders asynchronously (parallel compilation where the browser supports it) and draws once they are ready, within a bounded wait.
- The walk and tour chain's materials are compiled when the chain attaches; compilation runs again after a GPU context restore.
- The viewer's `ready` event (and its app-ready flag) now fires after the first picture is drawn, so a host that screenshots on `ready` never sees a blank canvas; no other public API change.
- A capture requested before compilation resolves links its programs synchronously, as before; accepted.

## Capabilities

### New Capabilities

- `first-frame`: how the player prepares and shows its first picture.

### Modified Capabilities

None.

## Impact

`src/render/render-runtime.ts` (start and first draw; at its line limit, so the logic lives in a small module), `src/app/viewer-stage.ts` (start), the walk chain attach path, context recovery, tests and a load measurement.
