# Brainstorm

## Problem

The interior light should take a colour temperature on a warm-to-cold scale like LED lamps, set from a new general settings panel of the viewer (its first setting) and by the host; the panel opens from a button next to «Interior style», shown only when the host asks. Folded in: in walk and tour, direct sunlight on interior floors comes close to clipping at the walk exposure.

## Related work

The room lighting in walk and tour (probe grids and room probes) and draw-on-demand landed just before. Lamp light descriptors and live lamps come in a later step; the lightmap bake later still.

## Doubts

Which lights a temperature tints; the kelvin-to-colour formula and the default; grids and probes after a change; the sun in walk; the panel in the player's own UI layer; the host contract; persistence; tests.

## Approaches considered

1. **Tint every interior light, environment included (author's first question).** Partner: tinting the shared environment colours reflections and metals and risks the reference rig and swatches; tinting only its diffuse makes illumination and reflections disagree. Rejected.
2. **Tint artificial light only (partner).** The bank's lamps and walk's ambient floor change; the hemisphere, the fill, the sun, the sky and the studio environment stay (they stand for daylight and the calibrated view). A daylight-only room changes less than a lamp-lit room: honest for an LED control.
3. **A kelvin default that reproduces today (author).** Partner: today's light is a mix (warm sky, brown ground, warm sun, blue fill, lamps `#ffd9a4`); no single kelvin reproduces it. Default «Original» (no temperature) instead.

## Decision

1. **Scope**: artificial light only (bank lamps, walk ambient floor). Reference rig and swatches untouched; `LIGHTING_STANDARD_VERSION` stays 1.
2. **Values in the standard**: temperature range 2700–6500 K, step 100, default `null` («Original»: no conversion, today's colours exactly).
3. **Formula** (pure module in the lighting standard, exported): Helland's approximation for the range (t = K/100; R = 255; G = 99.4708025861·ln t − 161.1195681661; B = 138.5177312231·ln(t − 10) − 305.0447927307; clamp 0–255, /255, sRGB-decode), normalised to the original light's luminance (Y = .2126R + .7152G + .0722B), intensity unchanged, linear channels may exceed 1.
4. **Walk and tour**: today's grid bake hides furniture (lamps included) and zeroes fill, hemisphere and the ambient floor, so the grid input does not change with temperature; lamp and floor colours update at once and the room probes are re-captured after the slider settles, budgeted over frames (the existing refresh drains synchronously). When lamps join the grid bake (lamp step), a temperature change re-bakes.
5. **Sun in walk**: PBR Neutral already compresses highlights; first measure the sunlit-floor peak, then a walk-only, room-only direct-sun factor of 1/3.5 inside the room boxes in the walk patch (exposure 3.5, ambient floor 0.05 and the bake unchanged); editing and capture states use factor 1. Façades keep their sun.
6. **Panel**: in the player's own UI layer (decided with the project lead; no React) (`src/ui/settings-panel.ts`), plain CSS over the player's tokens, shadcn anatomy and accessibility as the behaviour reference: a labelled non-modal popover that becomes a bottom sheet in narrow viewers, a native range input with translated `aria-valuetext` and a value read-out, an «Original» reset, Close, `aria-expanded`, Escape, outside dismissal, focus return, chrome kept awake while open; no `showModal()` (it would make the embedding page inert). Placement: an extension attached to the control bar's end next to «Interior style», the bar centred on its existing content.
7. **Host contract** (additive): mount options `settings: { show }` (default false) and `lighting: { temperature }` (number or null); attributes `settings` (existing flag syntax) and `light-temperature` (number or `original`); query params `settings`, `lightTemperature`; `ViewerHandle.setLightTemperature`, the value in `getState()`, event `lightTemperature`; iframe command and event. The local demo enables the settings button; the studio enables it and passes its saved value.
8. **Persistence**: host configuration; no scene schema change now. If the temperature becomes authored scene lighting (bakes, standalone exports), it moves into the scene then; future bake and cache keys include it independently of the standard's version.

## Rejected

1. Tinting the environment or its diffuse only: reflections and the reference rig.
2. A kelvin default: cannot reproduce today's mix.
3. Scaling the baked SH by a colour ratio: would tint daylight.
4. A generic extra highlight shoulder: PBR Neutral already compresses.
5. Lowering the sun globally: darkens façades; lowering exposure and raising the floor: flattens rooms.
6. React and the shared React kit inside the player: a second UI system and runtime dependency for one control.

## Open questions

None left.
1. Placement (decided by the project lead): the settings button is an extension attached to the control bar's end next to «Interior style»; the bar stays centred on its existing content, so nothing moves; the extension exists only when the host enables the button and follows the bar's narrow-screen rule.
2. Persistence (decided by the project lead): the temperature is the author's choice, saved by the editing host per project and passed on mount to every published embed (studio delivery, hosted tours, client-site embeds, iframe), so visitors see the author's value; the settings button stays hidden for visitors by default.

## Process

One round with the independent partner (read-only), given the product decisions and eight questions; it chose the artificial-light scope and the «Original» default, verified the grid bake excludes lamps today, measured the bar's layout, and proposed the walk sun factor and the host contract.
