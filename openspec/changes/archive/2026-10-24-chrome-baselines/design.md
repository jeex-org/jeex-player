# Design

## Context

See proposal.md for the defect. Playwright's `toHaveScreenshot` accepts a capture-time stylesheet only as `stylePath` (the inline `style` option exists on `screenshot()` and is ignored by the assertion). Playwright injects that stylesheet into every frame and every open shadow root for the capture and removes it afterwards, but waits for fonts only in the frame it captures. The viewer root paints a flat `--jeex-backdrop` behind its canvas.

## Goals / Non-Goals

**Goals:**

- A chrome baseline shows the chrome and changes when the chrome changes.
- Nothing the camera sees reaches a chrome baseline.
- The captured chrome state is the same on a fast and on a slow renderer.

**Non-Goals:**

- Comparing the blur and contrast of the glass plates over a real scene: over a flat backdrop they are not observable. The canvas baselines remain the only picture of the scene.
- Changing canvas baselines, product code or the suite's renderer.

## Decisions

1. **One stylesheet file, `tests/e2e/still-chrome.css`.** `canvas { visibility: hidden }` (box kept, nothing painted, for the scene, plan and mini-map canvases alike, since all three depend on the camera) plus `transition: none; animation: none` on every element. Passed to the assertion as `stylePath`; its text is exported for host-css, which needs the rules applied for the rest of the test because it also reads computed styles. Alternatives: hand-walking frames and shadow roots in the page (duplicates Playwright), a flat layer stacked under the chrome (changes the product's stacking for a test), `mask` (the defect).
2. **Fonts in every frame.** The helper awaits `document.fonts.ready` in each frame of the page before the assertion, because the iframe test's chrome lives in a child frame.
3. **State pinned by the caller, asserted before the shot.** The bar's idle timer re-arms while the bar is hovered, so a test that wants it open rests the pointer on the brand lockup (unbranded: on the bar's own padding, there is no lockup) with `force`, and asserts `data-collapsed="false"`. A test that wants it collapsed waits for `data-collapsed="true"`. The two-viewer page shows one of each. The scroll-tour page waits for its collapse before freezing frames. The helper documents this contract rather than guessing a state itself.
4. **Tolerance measured, not assumed.** Against the new baselines a 2 px change of the bar's padding changed 635 to 3,137 pixels per page and passed the old 2 % ratio (18,432 pixels at 1280x720) on every page. Repeated captures, and captures from two different camera views, differ by 0 pixels. The seven chrome tests also pass unchanged with the scene on pure SwiftShader. The chrome tolerance is therefore `maxDiffPixels: 100`. The host-CSS test keeps its own 2 % budget under its own name, since it compares two states of one page with its own per-channel step; its spec scenario now states that budget directly.

## Risks / Trade-offs

- [Hidden canvases still render, so captures still wait behind SwiftShader frames] → the screenshot timeout and `holdFrames` already cover that; nothing new is promised about speed.
- [A camera-dependent DOM element (checkpoint badges, door HUD, a running tour clock) appearing in a chrome shot] → not on screen in any captured state; if one appears, the baseline should fail, not hide it.
