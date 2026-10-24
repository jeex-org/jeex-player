# Design

## Context

The settings plate (`[data-jeex="settings-extension"]`) is an absolutely positioned wrapper appended as the control bar's last child, so the bar's flex layout and centring never see it. The stylesheet positions it with logical insets (`inset-inline-start: calc(100% + 4px)`, and `inset-inline: auto 0` under the bar), but `SettingsPanel.place()` checks physical right-hand clearance and `anchor()` writes physical `top`/`right` custom properties aligned to the button's right edge. In a left-to-right bar both agree; under an inherited right-to-left direction they do not. The `settings` attribute is frozen at mount by `element-attributes.ts`, and every option row that is not listed as live is frozen the same way.

## Goals / Non-Goals

**Goals:**
- `settings.side: 'start' | 'end'` through the option table, the schema, the attribute and the query parameter.
- Pixel-identical default: the chrome screenshot baselines pass without re-shooting.
- Placement and panel anchoring that resolve logical edges by the bar's computed direction.

**Non-Goals:**
- Full right-to-left support of the chrome, a collision solver against host content, a live side, new strings.

## Decisions

1. **One enum row** `'settings.side'` in `OPTION_SCHEMA` (`query: 'settingsSide'`, `attr: 'settings-side'`, values `['start', 'end']`, default `'end'`), the Zod object `settings: { show, side }`. The generic table drives parsing, the query, the attribute and the frozen classification, so no new resolver code. Alternative `'left' | 'right'`: rejected, it contradicts the logical insets already in use.
2. **Side stamp on the nodes**: the plate and the panel carry `data-side="start"|"end"`. CSS rules for `[data-side='start']` mirror the end rules: beside `inset-inline: auto calc(100% + 4px)` (end inset `calc(100% + 4px)`, start inset reset), under `inset-inline: 0 auto` with the same `calc(100% + 6px)` block offset, in the existing `[data-placement='under']` rule and the 600 px container query. The `end` rules stay byte-identical, so the default cannot move. Plain CSS inside the component layer over `--jeex-*` tokens.
3. **Wrapper order**: for `start` the wrapper is prepended to the bar (`bar.prepend`), so Tab order follows visual order; for `end` it is appended as now. The panel stays right after the bar. No `tabindex` changes; focusout, Escape and focus return keep working because they test containment, not order.
4. **Direction-aware `place()`**: read `getComputedStyle(bar).direction`; resolve the chosen logical edge to a physical side (start = left in `ltr`, right in `rtl`; end the opposite) and test that side's clearance: `bar.left - gap - plateWidth - 8 >= frame.left` for a left side, today's formula for a right side. For `end` in `ltr` this is exactly today's check.
5. **Direction-aware `anchor()`**: when the panel's aligned edge resolves to the right, write `--jeex-settings-right` as today and leave `--jeex-settings-left` unset; when it resolves to the left, write `--jeex-settings-left = max(8, button.left - frame.left)` and the stylesheet resets `right` to `auto` for that case (a `[data-anchor='left']` stamp on the panel). The bottom sheet rule at 430 px keeps overriding both. Then clamp so the panel stays inside the viewer (its start edge on the button where that fits).
6. **Resize order** stays `place()` then `anchor()` when open, in the existing ResizeObserver.

## Risks / Trade-offs

- [Host content near the bar's start can overlap a start-side plate] → the host chooses the side; documented in the README, no solver.
- [A direction change after mount is not observed] → placement is re-measured on every resize; a direction flip without a resize is not a known use and gets no listener.
- [The new start-side CSS could leak into the end layout] → the end rules are untouched and the chrome baselines run unchanged on the GPU, as the gate does.
