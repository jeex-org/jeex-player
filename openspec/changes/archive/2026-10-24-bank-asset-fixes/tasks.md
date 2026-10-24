# Tasks

## 1. Tests that fail on the current bank

- [x] 1.1 Add `src/assets/asset-bank-fit.test.ts` (chair height and rear legs, TV height, TV screen and casing finishes, carcass-top blocking heights, taps inside the plan) and make the plant box test vertex-exact; verify they fail before the fixes (on the unchanged bank: 40 of 40 bank-fit tests and 8 plant box tests red)

## 2. Fixes

- [x] 2.1 Chair rear posts on the floor, back slat and rail on the lean; verify the chair tests pass and the built box is 0.44 x 0.860 x 0.490 m
- [x] 2.2 Name tap and carcass parts, declare blocking heights 0.94 / 0.88 / 0.58 m, update the pinned island value; verify the fixture tests and `src/layout/rules/index.test.ts` pass
- [x] 2.3 TV: dims height 1.366 / 1.512 m, `screen_tv` finish with a new UUID v7, bezel on the screen slot, stand on `leg`; verify the TV tests pass
- [x] 2.4 Fit plant crowns on exact bounds; verify every plant variant's top is at its dims height and the plant suite passes
- [x] 2.5 Open the vanity's vessel basin; verify by the open-basin test and a render

## 3. Integration

- [x] 3.1 `bash scripts/check.sh fast` green
- [x] 3.2 Before/after renders of every fixed object and a contact sheet, inspected
- [x] 3.3 Run every canvas and chrome screenshot spec in the gate environment; re-shoot only the baselines that fail (none did: 59 passed, the canvas tolerance absorbs the change; chrome baselines unchanged)
