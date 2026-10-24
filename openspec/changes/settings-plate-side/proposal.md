# Proposal

## Why

The settings plate is always attached to the control bar's end. A host that keeps its own control near the viewer's top end cannot show both without moving its own control; it needs to put the plate on the bar's other side.

## What Changes

- A new mount option `settings.side`: `'end'` (default, today's placement, pixel-identical) or `'start'`, read once at mount. Attribute `settings-side`, query parameter `settingsSide`; a change after mount warns and does nothing, like `settings`.
- For `'start'` the plate attaches to the bar's start: beside it where it fits, under it on narrow viewers or when a long scene name leaves no room. The open panel aligns its start edge with the button. Keyboard order follows the visual order.
- Start and end are the bar's inline edges by its writing direction; the placement and panel anchoring become direction-aware, the left-to-right default unchanged.
- README option and attribute tables and the settings section; CHANGELOG.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `viewer-settings-panel`: the settings button can attach to either inline edge of the control bar.

## Impact

`src/app/viewer-options.ts` and `viewer-options.schema.ts` (type, default, option table row), `src/ui/viewer-ui.ts` (passes the side), `src/ui/settings-panel.ts` (side stamp, wrapper order, direction-aware `place()` and `anchor()`), `src/ui/styles/viewer.css` (start-side rules), the local demo if it shows the option, tests (options, schema, element, component placement, e2e), README and CHANGELOG. No new strings, no new dependency.
