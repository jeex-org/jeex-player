# Proposal

## Why

The e2e chrome baselines did not test the chrome. The shared helper masked every canvas, and Playwright paints a mask over the element's whole box; the scene canvas fills the viewer, so the mask covered the control bar, the mode switcher and every other plate. Five of the seven chrome baselines were flat magenta where the viewer is, and the iframe one carried the live 3D picture because a mask does not reach into a frame. Any chrome regression passed.

## What Changes

- The chrome screenshot helper takes its shot under one capture-time stylesheet that leaves every canvas unpainted (the viewer's flat backdrop shows through) and turns transitions and animations off, in every frame and open shadow root; it waits for fonts in every frame. No `mask`.
- The host-CSS isolation test uses the same stylesheet text, so both kinds of chrome comparison see the same thing.
- Every chrome test puts the control bar into one state that holds for the whole capture (open under a resting pointer, or collapsed after its idle timer) and asserts it before the shot.
- All seven chrome baselines are re-shot in the gate's environment and checked by eye. The chrome tolerance becomes a measured pixel count (100 pixels) instead of 2 % of the page, which let a 2 px padding change of the control bar through. Canvas baselines are untouched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chrome-style-isolation`: the pixel scenario of the host-CSS test named its 2 % budget as "the chrome tolerance of the other chrome baselines". The chrome baselines now use a much tighter pixel count, so the scenario states its own 2 % budget instead. The viewer's behaviour does not change.

## Impact

- `tests/e2e/support.ts`, a new `tests/e2e/still-chrome.css`, the chrome tests in `index`, `embed-element`, `embed-two`, `embed-iframe`, `scroll-tour` and `unbranded` specs, `host-css.spec.ts`, and a comment in `tests/headless-webgl.ts`.
- The seven `*-chrome*.png` baselines under `tests/e2e/__screenshots__/linux/`.
- No product code, no dependency.
