# Tasks

## 1. Helper

- [x] 1.1 Add `tests/e2e/still-chrome.css` and make `expectChromeScreenshot` use it as `stylePath`, wait for fonts in every frame, and drop `mask`; verify `bash scripts/check.sh fast` is green
- [x] 1.2 Make `host-css.spec.ts` take its stylesheet text from the helper; verify the host-css spec passes
- [x] 1.3 Replace the comments that said the chrome baselines mask the canvas (`support.ts`, `tests/headless-webgl.ts`); verify `rg -n "mask" tests/e2e/support.ts tests/headless-webgl.ts` names no canvas mask

## 2. Deterministic chrome state

- [x] 2.1 Pin and assert the bar state in every chrome test (index, embed-element, embed-two, embed-iframe, scroll-tour, unbranded at both viewports); verify each test asserts `data-collapsed` before its shot

## 3. Baselines

- [x] 3.1 Re-shoot the seven chrome baselines through the heavy-run queue in the gate's environment (the NVIDIA renderer); verify only `*-chrome*.png` files changed in git
- [x] 3.2 Inspect every new baseline by eye and build a contact sheet outside the repo; verify each shows the expected chrome with no flat mask and no missing element
- [x] 3.3 Prove the helper catches a chrome change (a changed control-bar padding fails the chrome test) and ignores the scene (two different camera views give the same chrome shot); revert the scratch change and verify the tree is clean; adjust the tolerance only if the padding change passes

## 4. Integration

- [x] 4.1 Run the whole e2e suite once through the heavy-run queue with 2 workers; verify it is green with no canvas baseline changed
