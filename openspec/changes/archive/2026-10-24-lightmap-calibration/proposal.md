# Proposal

## Why

Baked indirect light is the largest remaining step towards photographic interiors. A bake made offline only helps when the player reads it exactly as it was made: the intensity factor, the colour space, the row order and the split between baked light and the live sun all have to be right, and a mistake in any of them is invisible until it is measured. This change wires lightmaps into the player and proves those four facts on a calibration scene with known answers, before any real apartment is baked.

## What Changes

- A new internal layer `src/lightmap/`:
  - the light-bake sidecar (format 1) as a validated boundary, including the list of baked lamps;
  - loading of an atlas page from lossless WebP mip levels, uploaded once per page with the prepared levels up to the contract's mip limit, linear and without premultiplication or flipping;
  - an RGBM decode composed onto the standard material's shader (rgb × M × range, before the lightmap intensity), composable with other shader patches;
  - a transactional binding of a bake onto a loaded shell by mesh entity id: one material clone per source material and page, lamps of the bake marked as baked, everything undone by one call.
- A render-layer seam `src/render/baked-surface.ts` (`markBakedSurface`, `isBakedSurface`, `setLampBaked`) that the lighting reads to keep only the live direct sun and specular on a baked surface. In this change it only sets flags.
- A calibration fixture (the bake's own calibration room: shell GLB, sidecar, ten WebP levels, about 170 KB) and browser tests that measure the intensity factor, the colour space, the orientation and the sun split.
- A development page `dev/lightmap-calibration.html` showing the calibration scene, the raw and decoded atlas, and the measured numbers.
- No public API, no viewer option, no scene schema change. Unbaked projects render exactly as before.

## Capabilities

### New Capabilities

- `light-bake`: how the player accepts a light bake (sidecar, shell identity, pages) and applies it to a shell (decode, binding, lamps, baked-surface marks), and what the calibration proves.

### Modified Capabilities

None.

## Impact

- New modules under `src/lightmap/` and `src/render/baked-surface.ts`; a new layer in the architecture policy; the schema joins the schema-module list; component coverage includes the new layer.
- New component test files with measured costs; a new fixture folder; a new dev page.
- No dependency changes. No bundle change for the shipped entries (nothing imports the new layer yet).
