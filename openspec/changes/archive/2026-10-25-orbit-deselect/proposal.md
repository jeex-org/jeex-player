# Proposal

## Why

In 360 a tapped sofa, window or door keeps its selection aura until something else is selected; there is no way to drop a selection by tapping the object again. The owner asked for a second tap on the selected object to deselect it.

## What Changes

- In 360, a tap on the furniture or opening that is already selected clears the selection and closes its panel.
- The orbit rig reports one pick callback per tap instead of a null "clear" call before the real one.
- The second click of a double click no longer counts as a tap in 360, so a double tap still selects once and flies in.
- Not changed: walk taps (a tap walks, a second tap speeds up), drag-to-look, wall and floor finish panels, plan modes, the public `select` event and `setSelection`.

## Capabilities

### New Capabilities

- `orbit-selection`: how taps in 360 select and deselect furniture and openings in the viewer's built-in editor.

### Modified Capabilities

None.

## Impact

- Code: the camera input (`repeat` on a tap), the camera controller (orbit ignores a repeat tap), the orbit rig (one callback per tap), the viewer editor (the toggle).
- Tests: unit tests of these four modules.
- No API, schema or option change; no new dependency; no picture changes.
