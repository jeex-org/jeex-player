# Proposal

## Why

A viewer whose host removes it from the page without calling `dispose()` keeps drawing into its detached canvas on every animation frame. On a software rasteriser this starved the browser badly enough that the next page in the same browser stalled for about a minute. `dispose()` remains the documented teardown, but a host that forgets it should not be able to freeze the browser.

## What Changes

- The render loop parks at its next frame while the viewer's canvas is not connected to a document. Nothing is disposed: the WebGL context, the scene and every resource stay as they are.
- The loop resumes by itself when the canvas is connected again (a host may move the viewer's container), with the frame clock re-synchronised so no hook sees the absence as one long step.
- Side effect, named: a box observation now also resumes a loop that was started while its canvas was not visible, once it can be seen.
- No public API change.

## Capabilities

### New Capabilities

- `render-loop`: when the viewer's render loop runs and when it stands still (detached canvas).

### Modified Capabilities

None.

## Impact

- `src/render/render-runtime.ts`: the frame-loop gate, the visibility helper and the box-observer callback.
- Tests: `src/render/render-runtime.test.ts`, `tests/e2e/detached-canvas.spec.ts`.
- `CHANGELOG.md`: Unreleased, Fixed.
