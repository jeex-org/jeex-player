# Tasks

## 1. Red tests

- [x] 1.1 Editor: with the panel closed between taps (as a press closes it), a second `handleFurniturePick` with the selected id clears the selection and closes the panel; another id switches; a third tap reselects; the same for an opening through `handleSurfacePick`
- [x] 1.2 Orbit rig: a furniture tap makes one `onFurniturePicked` call and no `onSurfacePicked`; an opening tap makes one `onSurfacePicked` call and no `onFurniturePicked`; a miss still calls both with null
- [x] 1.3 Camera input: the click with `detail` 2 emits a tap with `repeat: true`; `detail` 1 and a missing `detail` emit `repeat: false`
- [x] 1.4 Controller: a repeat tap in orbit does not reach `orbit.tap`; in walk both taps reach `walk.tap`; a drag emitting no tap stays covered by the existing input test

## 2. Implementation

- [x] 2.1 `repeat` on the tap gesture in `camera-input.ts`
- [x] 2.2 Orbit skips repeat taps in `camera-controller.ts`
- [x] 2.3 One callback per tap in `orbit-rig.ts`
- [x] 2.4 The toggle in `viewer-editor.ts`

## 3. Checks

- [ ] 3.1 Fast tier green; one full gate
