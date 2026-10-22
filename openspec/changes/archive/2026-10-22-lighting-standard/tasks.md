# Tasks

## 1. Engine upgrade

- [x] 1.1 Keep the r185/ACES screenshots of the three fixed tour views taken before the upgrade
- [x] 1.2 Query the registry for `three` and `@types/three`; pin 0.186.1 and the matching 0.186 types; install; typecheck and unit tests green
- [x] 1.3 Screenshots of the same views on r186 with today's rig (the middle stage)

## 2. Lighting module (`src/lighting/`), tests with each item

- [x] 2.1 `LightingThree` narrow type, `LightingError` with its codes, revision and colour-management checks before allocation (tests: wrong revision, colour management off, nothing allocated)
- [x] 2.2 Environment recipe as a pure function with frozen parameters (tests: colourless, deterministic, cosine-weighted irradiance on the key normal gives the calibration target)
- [x] 2.3 `LIGHTING_STANDARD` (deeply frozen) and `LIGHTING_STANDARD_VERSION`; options schema in `lighting-options.schema.ts` (tests: deep immutability, every rejected size and unknown key, size lowered to the renderer maximum)
- [x] 2.4 `createLightingContext`: renderer settings incl. shadow map, PMREM target ownership, cleanup on failed creation, idempotent dispose, `disposed` errors (tests with real three objects and a stub renderer; objects built by the passed namespace)
- [x] 2.5 Rigs: one rig per scene across contexts, idempotent attach, early detach, conditional restore of environment, intensity and rotation, context disposal before rigs, two contexts (tests for every scenario of the spec)

## 3. Player adoption

- [x] 3.1 `RenderRuntime` on the context and the apartment rig; `lights` removed; the remount after a context restore creates a new context (test: environment-lit surface not black after a simulated loss and restore, in the browser tier)
- [x] 3.2 Default-state capture builds its rig through the context with the runtime's shadow size (test updated: rig contents, shadow maps released, no lights left behind)
- [x] 3.3 Swatches on the reference rig with a half-float target and the display pass (tests: Neutral output, transparent background kept, renderer target and clear colour restored on failure, target reused)
- [x] 3.4 Development furniture gallery on the reference rig
- [x] 3.5 Capture tests moved from ACES to Neutral; a still and the live view agree on a lit surface within 2 %
- [x] 3.6 Browser test of the calibration fixture (±0.0036); freeze the constant

## 4. Publishing

- [x] 4.1 Library build pass `lighting` and the `./lighting` export with declarations
- [x] 4.2 Post-build test: the lighting entry and all its imported chunks carry no three.js and no `document`/`window`; consumer fixture typechecks `import … from 'jeex-viewer/lighting'`
- [x] 4.3 Dependency layers (`lighting` below `render`), purity test, knip entry, budget check for the new entry, viewer budget re-measured

## 5. Look and documentation

- [x] 5.1 Reference sheet (grey, white, black, two metals, saturated colours, sheen fabric) under the reference rig for eye review
- [x] 5.2 Tune the apartment values by the r185 / r186 ACES / r186 Neutral screenshots; write them into the standard and the tests
- [x] 5.3 E2e pixel baselines: an update run rewrote none (the new look stays within the canvas tolerance of the suite), so the committed baselines are kept
- [x] 5.4 README section «Lighting standard» (API, prerequisites, lost-context recovery, the capture/live difference) and CHANGELOG entries
