# Tasks

## 1. Frame-loop gate

- [x] 1.1 Unit tests first (`src/render/render-runtime.test.ts`, "a canvas taken off the page without dispose", on a frame queue that keeps every scheduled callback): parks at the next frame and an empty-box observation does not wake it; reattaching resizes before the first resumed frame and that frame's step is the time since the resume; started before attach starts on attach; a context restored while detached stays parked; no observer means no park; started while not visible starts when an observation finds it visible; stopped or disposed stays down. Verify by mutation: without the gate 5 tests fail, without the observer wake 4 fail; all pass with the fix
- [x] 1.2 Gate the frame callback before it re-schedules itself, report a detached canvas as not visible, and resume from the box-observer callback after the coalesced resize is queued; only where the observer exists; verify with the unit tests of 1.1
- [x] 1.3 Check the wake signal outside Chromium: a `ResizeObserver` probe page in Chromium and Firefox delivers one observation on ancestor removal, observed-element removal and each re-insertion; record the outcome in design.md
- [x] 1.4 Browser test `tests/e2e/detached-canvas.spec.ts` (WebGL draw-call count): no draw while the container is off the page, drawing resumes after re-insertion; verify red without the fix and green with it through the heavy-job queue, at most 2 workers
- [x] 1.5 CHANGELOG entry under Unreleased, Fixed; verify it names the behaviour and that `dispose()` stays the teardown

## 2. Integration

- [x] 2.1 `bash scripts/check.sh fast` green
- [ ] 2.2 The full quality gate through the machine's gate queue (run by the maintainer); on red, only the failed files are re-run

## Workflow follow-up

- Independent review of the artifacts.
- Archive the change after the review requirements are satisfied, then `openspec validate --all --strict`.
