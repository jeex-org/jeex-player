# Proposal

## Why

The player can apply an offline light bake to a live apartment shell (`applyBakedShell`), but nothing in the viewer calls it, so nobody can look at a baked apartment in the real viewer or compare it with the live one. Before a public manifest field exists, a page needs an internal way to mount a scene with a bake applied, and two pages (live and baked) need to open the identical camera view. Wiring a bake into a running viewer also has lifecycle rules (when to apply, when to drop) that the later public field must reuse, so the wiring belongs in its own module now.

## What Changes

- An internal wiring module, `src/lightmap/light-bake-wiring.ts`: applies a bake to a mounted document once it has settled, drops it before a rebuild, a release, a dispose and any revision the bake depends on, reports refusals on the log, and exposes its state.
- `SceneMount` drives the wiring: it hands each mounted document over with a `settled` promise (the first model pass and every library map of the shell), subscribes it to revisions before the builder repaints, and drops the bake first in `rebuild` and `release`.
- `ShellPaint.mapsSettled()` / `SceneBuilder.mapsSettled()`: a promise that resolves once every library map of the shell has attached or given up.
- `applyBakedShell` takes an optional `signal`, and re-reads the live shell after the files have loaded: an aborted attempt or a changed shell is refused, with the loaded pages released.
- Two internal page globals, read like `__JEEX_DEBUG_FLAGS__`: `__JEEX_DEBUG_LIGHT_BAKE__ = { sidecar, shell }` (URLs resolved against the page) names the bake every mount tries; `__JEEX_DEBUG_CAMERA__ = { mode, position, target }` is the pose the viewer opens in (`walk` stands there exactly, `orbit` snaps the orbit there).
- `CameraController.snapOrbit(position, target)`: the orbit stands at a pose at once, whatever the motion setting.
- `__viewerDebug.lightBake()` reports the wiring's state.
- A development page that mounts the demo flat with and without the global.
- No package export, no viewer option, no query key, no scene schema change. A page without the globals behaves exactly as before.

## Capabilities

### New Capabilities

- `light-bake-wiring`: when a light bake is applied to and dropped from a mounted document, and the internal page switches that trigger it and name the opening camera view.

### Modified Capabilities

- `light-bake-shell`: the apartment loader refuses when the live shell changed while the files loaded, or when its caller aborted.

## Impact

- New: `src/lightmap/light-bake-wiring.ts` and its test; `tests/component/light-bake-hook.test.ts`; `dev/light-bake-hook.*`.
- Changed: `src/shared/debug-flags.ts` and `.schema.ts`, `src/lightmap/baked-shell.ts`, `src/geometry/shell-paint.ts`, `src/geometry/scene-builder.ts`, `src/app/scene-mount.ts`, `src/app/viewer-app.ts` (passes the logger and the director), `src/app/viewer-boot.ts`, `src/camera/camera-controller.ts`, `src/app/viewer-debug.ts`, `src/app/debug-parts.ts`, README debug switches.
- Out of scope: the public `lightBake` manifest field, re-applying a bake after an edit, the selection highlight over a bound clone, matching the bake's light recipe to the live rig and the light temperature.
