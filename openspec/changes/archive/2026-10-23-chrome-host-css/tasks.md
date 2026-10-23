# Tasks

## 1. Hostile page and failing proof

- [x] 1.1 Add `dev/host-css.html` and `dev/host-css.ts`: `mountViewer` into a page with an aggressive unlayered sheet (`#host-hostile`) and the pilot page's rule; verify the page boots in the dev server.
- [x] 1.2 Add `tests/e2e/host-css.spec.ts`: at 390×844 and 1280×800, with the interior popover, reveal pill, hint card and degraded notice on screen, compare every chrome element's box and computed style (also hovered and keyboard-focused, transitions off), and the pixels of the viewer with the canvas unpainted (not Playwright's `mask`, which covers the full-size canvas and the chrome above it) at `CHROME_DIFF_RATIO`, with the host sheet on and off; verify all six tests FAIL on the current stylesheet.
- [x] 1.3 Add a «host page with global CSS» group to `tests/component/viewer-shell.test.ts`: element, `*` and body rules do not reach the chrome; `.jeex-viewer .mode-button` still overrides; theming properties still reach it; host content in a slot box keeps the host's rules; `!important` still reaches it; a page `::part()` rule still styles the shadow chrome; a sheet added inside a shadow root still wins; verify with `bunx vitest run tests/component/viewer-shell.test.ts` that the first case FAILS and the other six pass on the current stylesheet.

## 2. The guard

- [x] 2.1 In `src/ui/styles/viewer.css` add the typography boundary to `@layer reset` and the unlayered `all: revert-layer` guard, with the header comment updated; verify `tests/e2e/host-css.spec.ts` passes at both viewports and `bunx vitest run tests/component/viewer-shell.test.ts` passes.
- [x] 2.2 Verify the existing chrome baselines are unchanged: `index`, `embed-element`, `embed-two`, `embed-iframe`, `scroll-tour`, `unbranded` specs pass without updating a snapshot.
- [x] 2.3 Update README: the limit note in «What a pasted form does on its own» (producer's mark) and «Theming» (what is protected on the light-DOM path, the named override form, what is not protected); verify `bash scripts/check.sh fast` is green.
