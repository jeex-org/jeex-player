# Proposal

## Why

Asset bakes can write textures as KTX2 (Basis Universal), which stays compressed in GPU memory (about 4 to 8 times less than WebP decoded to RGBA). The player cannot draw them today: a GLB that requires `KHR_texture_basisu` is refused at parse and its procedural body stays, and the manifest refuses `.ktx2` room maps. Measuring WebP against KTX2 on real devices needs a player that draws both.

## What Changes

- Furniture GLBs that use `KHR_texture_basisu` load: the Basis transcoder is configured for the renderer the viewer draws with, detecting the compressed formats that renderer supports.
- Library room maps accept `tex/<versionId>/<role>.<px>.ktx2` beside `.webp`, one format per material, decoded through the same transcoder with every existing rule (per-file cap, document budget, deadline, shared images, colour space by role, size check) plus container checks, and drawn upright with correctly oriented normals.
- The transcoder's two files ship next to the player's bundles under content-hashed names (`lazy-jeex-viewer-basis-transcoder-<hash>.js` and `.wasm`) in the library build and the demo build, are answered by the dev server, and are found from every embed shape relative to the player's own file.
- The transcoder loads lazily: only when a KTX2 asset is first met, once per viewer; a WebP-only document fetches neither file. The boot budget is unchanged in kind; the new lazy files get budget lines, and the budget gate measures `.wasm`.
- A parsed model source now frees the textures of its materials when it is disposed.
- README: where the transcoder files live, what a host that rebundles the ES module must copy, and the Content Security Policy KTX2 needs.
- No new viewer option, no public export, no `package.json` `files` or `exports` change. A host override of the transcoder folder is proposed for clearance separately.

## Capabilities

### New Capabilities

- `compressed-textures`: decoding KTX2 (Basis Universal) textures: where the transcoder is found, when it loads, how it is shared within a viewer, and how GLBs with `KHR_texture_basisu` load.

### Modified Capabilities

- `room-surface-textures`: image orientation and decode checks extend to KTX2 maps.
- `project-materials`: texture file paths accept `.ktx2`, one format per material.

## Impact

- Code: `src/geometry/model-source.ts`, `src/geometry/asset-loader.ts`, `src/geometry/scene-builder.ts`, `src/materials/texture-source.ts`, `src/materials/library-uv.ts`, `src/materials/library-material.ts`, `src/geometry/library-surface.ts`, `src/assets/project-manifest.schema.ts`, `src/app/*` wiring, a new transcoder module, a build plugin shared by `vite.config.ts`, `vite.lib.config.ts` and `vitest.config.ts`, `scripts/budget-check.ts`.
- Build output: two new files next to the bundles in `dist-lib/` and `dist/assets/`. Hosts that serve the library build from their own server must also serve `.wasm` (as `application/wasm`).
- Dependencies: none added; three already ships the transcoder.
- Fixtures: small committed KTX2 files and one GLB with `KHR_texture_basisu`, made by repository scripts.
