## 1. Switches

- [x] 1.1 `debugLightBake()` and `debugCamera()` readers with Zod schemas; tests: absent, resolved URLs, malformed values off

## 2. Wiring

- [x] 2.1 `lightBakeWiring`: waiting, loading, applied, refused (one log entry), dropped; abort on drop; dispose a late apply; revision kinds that drop and keep; lamps unknown while waiting; an edited document not revived; tests with a fake apply
- [x] 2.2 `ShellPaint.mapsSettled` / `SceneBuilder.mapsSettled`; tests: pending until the held map attaches, at once without library materials
- [x] 2.3 `applyBakedShell` signal and live shell re-read after loading; browser tests: a shell changed while loading, an aborted attempt
- [x] 2.4 `SceneMount` drives the wiring: target with the settled promise, revision before the builder's repaint, drop first in rebuild, release and remount; tests with a recording wiring

## 3. Camera and debug surface

- [x] 3.1 `CameraController.snapOrbit`; test with motion on
- [x] 3.2 `applyStartView` opens at the debug camera; tests: walk and orbit, malformed ignored
- [x] 3.3 `__viewerDebug.lightBake()`; surface test

## 4. Proof

- [x] 4.1 Browser test on the mounted demo flat: named view, applied on the live shell objects, repaint drops, dispose restores, another revision refused with one warning, context loss and restore bakes once
- [x] 4.2 Development page with and without the globals; two screenshots of the same view looked at
- [x] 4.3 README debug switches; fast tier green; one standard tier through the heavy-work queue at the end (failed files only on red)
