# Brainstorm

## Problem

The settings plate is always attached to the control bar's end. A host that already keeps its own control near the viewer's top end (for example a help button) has nowhere to move the plate without moving its own control. The host needs to choose which side of the bar the plate attaches to, while the default placement stays exactly as it is.

## Related work

The settings panel and the light temperature landed with the light-temperature change; the baked-surface change since then touched only rendering. No work in flight changes the settings panel, the control bar or the option table.

## Doubts

1. Is a side option enough, or does the host need a reserved rectangle or a host slot for the plate?
2. Does `start` mean the physical left, or the inline start by writing direction?
3. Is the option live or read once at mount?
4. How does the plate fall back under the bar on the start side, and how does the open panel anchor so it stays inside the viewer?
5. Does keyboard order still follow visual order when the plate moves to the bar's start?
6. Who avoids collisions with host content near the bar's start?

## Approaches considered

1. **Side option `settings.side: 'start' | 'end'`** (author). The plate keeps its absolute wrapper inside the bar; only its inset edge changes. Cost: one enum option row, a few CSS rules, direction-aware placement and anchoring math. Risk: host content near the bar's start can overlap the plate; that is the host's choice of side.
2. **Reserved rectangles** (author). The host tells the viewer which areas it occupies and the plate avoids them. Rejected after reading `src/ui/host-slots.ts`: the slots own boxes for host content but have no general reservation or collision solver; adding one means measurement, updates and a placement policy for one known conflict.
3. **Plate in a host slot** (partner). Moving the built-in plate into a host slot detaches its position from the bar and mixes ownership of built-in and host content. Rejected.

The partner also found an existing inconsistency: the stylesheet positions the plate with logical insets, while `place()` measures physical right-hand clearance and `anchor()` always aligns physical right edges, so an inherited `dir="rtl"` already shows mixed behaviour.

## Decision

1. **Shape**: `settings: { show, side: 'start' | 'end' }`, default `'end'` (today's placement, pixel-identical). Attribute `settings-side`, query parameter `settingsSide`, an enum row in the option table, the schema, and the README option table.
2. **Meaning**: the logical inline edges of the control bar by its computed `direction`: start is the left in a left-to-right bar. The left-to-right default stays exactly as it is; the new placement and anchoring math is direction-aware (this also fixes the mix of logical CSS and physical measurement), without claiming full right-to-left support. A locale does not flip the side on its own; all shipped locales are left-to-right.
3. **Mount-only**, like `settings`: changing the attribute after mount warns and does nothing.
4. **Placement for `start`**: beside the bar's start with the same 4 px gap, or under the bar's start at a viewer width of 600 px or less or when it does not fit beside with 8 px to spare, with the same gap under the bar. The panel's start edge aligns with the button for `start`, its end edge for `end`; the bottom sheet at 430 px or less is kept. On resize the plate is placed first, then an open panel is anchored.
5. **Keyboard order**: for `start` the plate's wrapper is the bar's first child, so Tab order follows visual order; `end` is unchanged. No positive `tabindex`. Escape and focus return work as today.
6. **Collisions** with host content near the bar's start (a host's top-start slot, for example) are the host's to avoid by its choice of side; the viewer adds no collision solver.
7. **Tests**: the option table and schema (both values, default, frozen attribute); component placement at viewer widths 1280, 560, 400 and 360 for both sides (no existing control moves, the plate attached to the chosen edge, inside the viewer, long scene name, open panel follows a resize, keyboard order) with dispatched clicks; end-to-end start side through the query parameter and the attribute with an accessibility check; existing chrome baselines unchanged without re-shooting.

## Rejected

- Reserved rectangles: a general reservation and collision system for one known conflict.
- Plate in a host slot: detaches the plate from the bar and mixes built-in and host ownership.
- `'left' | 'right'` values: physical sides would contradict the logical insets the stylesheet already uses; `start`/`end` with the bar's direction is the consistent meaning.
- A live attribute: the plate is built once at mount, like `settings` itself; a live side would rebuild the bar's children for no known use.
- Always right-aligning the open panel: on the start side it would push the panel out of the viewer.

## Process

One read-only round with the partner agent on the author's brief; the partner read the code and answered all six doubts. No open questions remain.
