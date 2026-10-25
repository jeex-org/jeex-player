# Design

## Context

`camera-input.ts` turns an unmoved `click` into a `tap` gesture and `dblclick` into `double-tap`. `camera-controller.ts` sends a tap to `orbit.tap` in 360 and `walk.tap` in walk. `orbit-rig.ts` picks the surface and calls `onSurfacePicked` and `onFurniturePicked`, which `director-wiring.ts` forwards to `ViewerEditor.handleSurfacePick` and `handleFurniturePick`. The shell root closes the open panel on any `pointerdown` outside it, but the editor's aura (`selectedAssetId`, `selectedOpeningId`) stays until `clearSelection()`.

## Goals / Non-Goals

Goals: a second tap on the selected furniture or opening deselects it in 360; drag-to-look, double tap and walk taps behave as before.

Non-goals: toggling wall and floor finish panels (no aura, already closed by any press); plan modes; the public `select` event; host highlights; presses claimed by the host's asset move tool; Escape, which closes the panel and keeps the aura as today.

## Decisions

1. **One callback per tap.** `OrbitRig.tap` calls `onFurniturePicked(id)` for furniture and `onSurfacePicked(pick)` for an opening, wall or floor; a miss calls both with null. The leading null calls cleared the selection before the editor could compare, and `selectFurniture`/`selectOpening` already clear the previous selection. Alternative: keep the calls and remember the previous selection across them. Rejected: an ordering contract between two callbacks is easier to break than one call.
2. **Toggle on the aura, in the editor.** `handleFurniturePick(id)` with `id === selectedAssetId` calls `clearSelection()` and `closePanel()`; `handleSurfacePick` does the same for an opening whose id equals `selectedOpeningId`, compared before its leading `clearSelection()`. On a door, `doors.showFor` still runs first, so the door button rises again on the deselecting tap; a tap on the button itself never reaches the canvas. The panel's open state is not consulted, since a press has already closed it.
3. **`repeat` on a tap.** `CameraGesture` `tap` gains `repeat: boolean` (`MouseEvent.detail > 1`; a missing or zero `detail`, as from a synthetic or assistive click, is `repeat: false`). The controller skips `orbit.tap` for a repeat tap and passes walk taps through unchanged. Alternative: a timer that waits for a possible double click. Rejected: it delays every single tap.

## Risks / Trade-offs

- A second tap faster than the double-click interval is a double tap: it flies in rather than deselecting, as a fast double tap always has.

- iOS Safari may report `detail` 1 for the second tap of a double tap on a `touch-action: none` canvas. Then a double tap on an unselected object selects, deselects and flies in. Checked on a device after landing; if so, a follow-up adds a time and distance recognizer.
- A user who meant to reopen a closed Replace panel by tapping the same object now deselects it instead and needs a third tap. This is what the owner asked for.
