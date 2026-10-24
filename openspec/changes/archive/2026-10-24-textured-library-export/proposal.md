# Proposal

## Why

A GLB or USDZ exported from the player shows every room surface drawn by a library material in one flat colour: the bundled scanned finishes lost their texture in the export when they became library materials, and project library materials are not even resolved by the export, so they come out in the bundled catalogue's look or the surface default. An exported apartment should look like the one on screen.

## What Changes

- The export of a mounted viewer draws room surfaces with the same library materials the live view draws, from the project's materials and the bundled finishes.
- Their maps are written into the file: the colour map (albedo, or the tint map with its tint), the normal map, and the ARM map as glTF occlusion and metallic-roughness from one image; in USDZ as UsdPreviewSurface textures.
- The tiling, grain angle and rotation of the live view are kept by writing the surfaces' texture coordinates already transformed; no texture-transform extension is used.
- A tint whose colour factor would exceed glTF's range is written into a derived colour image instead.
- Maps come only from the viewer's own texture sources, at the size the live view loads; a map that cannot be had leaves that part flat, as live. KTX2 materials export flat.
- An export without a mounted viewer (or without a WebGL context) stays as it is today.
- The public export API does not change; the files get larger (images).

## Capabilities

### New Capabilities

- `library-material-export`: how room surfaces drawn by library materials are written to GLB and USDZ: material resolution, maps, colour factor, tiling, fallbacks and determinism.

### Modified Capabilities

- `builtin-finishes`: the requirement "Export of built-in surfaces" changes from flat colour to the textured export.

## Impact

- Code: `src/app/export-gltf.ts`, `src/app/export-usdz.ts`, a new export helper module in `src/app`, `src/app/scene-mount.ts`, `src/app/handle-commands.ts`, `src/app/viewer-api.ts`, `src/geometry/scene-builder.ts` (room-surface materials option).
- Output: GLB and USDZ gain images, textures, samplers and baked UVs on library surfaces; sizes grow by the PNG maps of the finishes in use.
- No new dependency; the export stays in its lazy chunk; the boot bundle does not change.
