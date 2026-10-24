# Design

## Wiring

`lightBakeWiring({ source, log, changed, fetchBytes?, apply? })` returns `{ mounted, revision, drop, state, idle }`. The module knows nothing about the viewer: the caller hands it a `BakeTarget` per mounted document (`document` identity, `scene`, `root`, project materials and finish lookup, `settled`), and calls `revision` and `drop` at the right moments. A later public manifest field supplies `source` from the project instead of the page global and reuses everything else.

States: `off` (no source), `waiting` (until `settled`), `loading` (the apply runs), `applied`, `refused`, `dropped`.

Each attempt owns an `AbortController`. `drop` aborts the attempt in flight or disposes the applied bake; an apply that still comes back after an abort is disposed at once. A revision that drops the bake marks the document (`WeakSet` over the `SceneModel`) so a later remount of the same document does not revive it; any other mount, including the remount after a restored WebGL context of a document nobody edited, tries again. The restore re-mounts from scratch (`SceneMount.remount`), whose `release` drops the old bake first, so a bake is never bound twice.

`changed` refits the sun shadow (the shell's geometry objects and transforms changed; the sun's survey includes them) and asks walk and tour for a redraw.

## Settled

`settled = Promise.all([upgradePass, builder.mapsSettled()])`. `upgradePass` is the chained model upgrade promise as it stands right after this mount's pass was queued, so it resolves when that pass ends; a body swapped in later would carry lamps the bake never marked. `mapsSettled` loops over the shell paint's in-flight `LibrarySurface.load` promises until none is left; texture work still starts a frame after the mount, untouched.

## Order against repaints

`Fanout` notifies in registration order, and `SceneMount.mount` subscribes the wiring before `builder.bindModel`, so the wiring's drop (which restores the source material on each bound mesh) runs before the builder's repaint, whose `mesh.material === old` checks would otherwise miss the bound clone. `present()` commits through the same fan-out.

## Camera

`applyStartView` reads `__JEEX_DEBUG_CAMERA__` first; a valid pose switches the buttons, the hint and the mode as an explicit choice would, then `walk` calls `CameraDirector.enterWalkAt` (cancels any entry glide or step, stands at the pose, adopts its look) and `orbit` calls the new `CameraController.snapOrbit`, which `flyTo` now uses under reduced motion. The orbit clamps radius and pitch, so an orbit pose outside its limits lands on the nearest allowed one; two pages with the same pose still match. A query key was rejected: the query reader feeds the public iframe page, so a key there would be a public URL option.

## Not handled here

1. The selection highlight clones the current material without its compile hooks and restores its saved reference; over a bound clone it would draw without the lightmap decode, or restore a disposed clone after a drop. Hosts rarely highlight on a debug page (`select` is off by default), so this waits for the public step.
2. The bake's light recipe is judged by the sidecar schema, not matched to the live rig, and a light-temperature change has no effect on baked lamps. The public step decides how a mismatched rig is refused.
3. Captures should wait for `__viewerDebug.lightBake().state === 'applied'` and then a drawn frame: `ready` follows the first picture, which comes before the bake.
