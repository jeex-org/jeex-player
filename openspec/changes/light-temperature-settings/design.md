# Design

## Context

See proposal.md and brainstorm.md. Today's colours: hemisphere sky `#fffcf6`, ground `#6d675f`, sun `#fff4e6`, fill `#bed7de`, bank lamps `#ffd9a4`. The walk grid bake hides furniture (lamps included) and zeroes fill, hemisphere and the ambient floor. The control bar is centred and shrink-wrapped with 4 px gaps. `render-runtime.ts` is near its line limit and `viewer-app.ts` at 500: new logic goes into new modules.

## Decisions

1. **Standard**: `LIGHTING_STANDARD.temperature = { min: 2700, max: 6500, step: 100, default: null }`; `src/lighting/colour-temperature.ts` (pure, exported from the lighting entry): kelvin → unit-luminance linear RGB by Helland (t = K/100; R = 255; G = 99.4708025861·ln t − 161.1195681661; B = 138.5177312231·ln(t − 10) − 305.0447927307; clamp, /255, sRGB decode, divide by Y). Version stays 1. The entry's size budget is re-measured by its own rule if it grows.
2. **Applying it**: a player module `src/render/light-temperature.ts` owns the current value and applies it to every bank lamp (by a lamp tag the bank already sets, colour = original colour's luminance × unit colour) and to walk's ambient floor; «Original» restores the original colours exactly. Lamps created later (model upgrades, edits) get the current value. In walk and tour, after the value settles (250 ms), the room probes are re-captured over frames (a budgeted probe-only refresh); the grids are not re-baked (their input excludes these lights today). Every change invalidates the on-demand gate.
3. **Sun factor**: in the walk shader patch, locate the fragment's room before the directional-light loop and scale the sun's `directLight.color` by `mix(1, walkSunScale, inRoom)` (fill is already 0 in walk); `walkSunScale = 1/3.5` in the walk tuning; the editing and capture states pass 1. Measure the sunlit floor's peak and texture before and after.
4. **Panel**: `src/ui/settings-panel.ts` and its CSS over `--jeex-*` tokens; the button is an extension element appended after the control bar's last control in its own wrapper, positioned so the bar's centring ignores it (absolute to the bar's end edge), wrapping with the bar's narrow-screen rule; native `<input type="range">` with `aria-valuetext`, an `<output>`, an «Original» button, a Close button; `aria-expanded` on the button; Escape, outside press, focus return; keeps chrome awake; no `showModal()`. Strings in `src/shared/messages.ts` and all six other catalogues.
5. **Contract**: options in `viewer-options.ts`/`.schema.ts`/`option-sets.ts`/resolvers (a bounded nullable temperature kind), attributes live in the element, query parameters in the demo parser, handle method and state, `lightTemperatureChange` in `viewer-events.ts`, iframe command and event schemas, bridge and host methods (additive). The local demo enables `settings`.
6. **Persistence**: host configuration; the editing host saves per project and passes it to published embeds. No scene change.

## Risks / Trade-offs

1. [Lamps of the built-in bank are the only artificial lights today; a room without bank lamps changes only through the walk ambient floor] → honest by design; the lamp step brings descriptor lamps under the same control.
2. [Probe re-capture after a change costs frames in walk] → budgeted, after a 250 ms settle.
3. [The attached button must not shift the centred bar] → a layout test compares control positions with and without the button.
