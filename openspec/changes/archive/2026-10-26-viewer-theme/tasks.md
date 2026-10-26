# Tasks

## 1. Red tests

- [ ] 1.1 Resolver: hex, `rgb()`, `light-dark()` in both schemes and `color-mix()` resolve to opaque hex; alpha is dropped; an invalid value falls back to the NEUTRAL default, not beige.
- [ ] 1.2 Runtime (unit):
  - `setBackdrop` changes the background texture and fog colour, and disposes the previous owned texture;
  - another viewer's sky is untouched;
  - `dispose()` frees the owned sky;
  - while the HDRI is active, the live background stays and the restored fallback is the new pair (orbit → walk → setBackdrop → orbit).
- [ ] 1.3 Component (browser):
  - the root's `--jeex-backdrop` reaches the canvas pixels in 360 and the pre-frame CSS background;
  - `refreshTheme()` applies a change;
  - two viewers stay isolated;
  - the shadow-root path works.
- [ ] 1.4 Component: an accent override alone recolours the pill, hint icon, loading marks and track, tour knob and focus ring; the computed strong and muted values in both schemes; on-accent contrast holds for the default accent in both schemes; the state cards paint `--jeex-state-surface`; the defaults carry no former gold or beige.
- [ ] 1.5 Component, 350 × 197 (the 16:9 hero at a 390 px phone width):
  - the hint shows its icon only and expands on tap and on Enter;
  - the first camera drag collapses it, also with `chromeAutoHide` off;
  - moving the pointer does not collapse it;
  - at 800 px the toggle is absent from the tab order and the card is unchanged;
  - the `hint` part and `aria-live` are kept;
  - the reveal button's fade-in waits for the bar's fade-out, and it leaves at once.
- [ ] 1.8 Mini-map: `paintPlan` with an accent paints the highlight, cone and dot in it; `setAccent` repaints the canvas with no former orange.
- [ ] 1.6 Site build: the theme link is present only in `out/demo/embed.html`.
- [ ] 1.7 Pending handle: `refreshTheme()` is forwarded after start and does nothing before it.

## 2. Implementation

- [ ] 2.1 Resolver, stage wiring, `refreshTheme()`, `THEME_PROPERTIES`
- [ ] 2.2 Runtime and HDRI seam
- [ ] 2.3 CSS tokens and neutral defaults; the state surface
- [ ] 2.4 Hint toggle; reveal button delay
- [ ] 2.5 Site demo-frame theme; README theming section; CHANGELOG with a migration snippet
- [ ] 2.6 Screenshot baselines regenerated through the heavy queue

## 3. Checks

- [ ] 3.1 Fast tier green
- [ ] 3.2 OCR review of record and security review; one answer commit
- [ ] 3.3 One full gate
