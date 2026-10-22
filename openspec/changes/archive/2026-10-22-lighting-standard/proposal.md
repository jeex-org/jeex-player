# Proposal

## Why

Applications that show the same 3D content light it differently: the player uses ACES Filmic with a synthetic room environment at half strength and a fixed sun; asset review, store previews and swatches each use their own tone curve, exposure and lights, some with no environment at all. A material that looks right in one place looks different in another. One lighting standard, defined once and used everywhere, fixes that, and it has to be published so other applications can render with exactly the same code.

## What Changes

- **three.js 0.185.1 → 0.186.1** (with the matching type definitions).
- **New lighting standard**: PBR Neutral tone mapping, exposure 1.0, sRGB output, linear working space, and a package-owned neutral grey environment, calibrated so that under the reference rig a linear-0.18 diffuse surface facing the key light reads linear 0.18 on screen.
- **Two rigs**: a *reference* rig (neutral environment and one white key, no room) for material swatches and asset review, and an *apartment* rig (environment, sky, sun with its shadow, fill) for the player's scenes.
- **New public entry `jeex-viewer/lighting`**: `createLightingContext(three, renderer)` bound to the caller's own three.js and renderer, rigs created from that context, a read-only description of the standard and an appearance version number. The entry imports no three.js at runtime and touches no DOM; it refuses any three.js revision other than 186.
- **The player adopts it**: the live view, material swatches, default-state captures and the development furniture gallery all light through the standard. The demo's look changes (the tone curve and the environment); it stays within the end-to-end suite's canvas tolerance, so the pixel baselines are kept.

## Capabilities

### New Capabilities

- `lighting-standard`: the tone mapping, exposure, colour spaces and calibration every renderer of JEEX content uses; the reference and apartment rigs; the public lighting entry, its revision check, resource ownership and versioning.

### Modified Capabilities

None.

## Impact

- New layer `src/lighting/` (pure of DOM, type-only three imports) and a new library build pass and `package.json` export.
- `src/render/render-runtime.ts`, `swatch-preview.ts`, `src/app/capture-commands.ts`, `dev/furniture-gallery.ts` switch to the rigs; `RenderRuntime` no longer exposes its named lights.
- Tests: unit tests for the module (revision check, calibration by integration, ownership and disposal), a browser test of the calibration patch; the e2e baselines are kept (the new look stays within their tolerance).
- Bundle: a few kilobytes; `RoomEnvironment` is no longer imported.
- Every consumer must use three.js r186 and its own renderer; a mismatched revision is an error, not a warning.
