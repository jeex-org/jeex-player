# Design

## Context

See proposal.md for the motivation. The export builds its own `SceneBuilder` from the committed document (`prepareExport` in `src/app/export-gltf.ts`, shared by `export-usdz.ts`) so a re-export is byte-identical and nothing of the live graph (door animation, selection aura, bake) leaks in. Library surfaces (`geometry/library-surface.ts`) ask a `TextureSource` (`materials/texture-source.ts`) for views of shared decoded images and set a texture matrix per material (`materials/library-uv.ts`). The live viewer holds one project source per document and one bundled source per viewer (`app/scene-mount.ts`). three's GLB writer reads only `offset`/`repeat`/`rotation` of a texture, never its matrix; it shares one texture when the metalness and roughness maps are the same object, caches images by image object and derived normal maps by texture object, and refuses compressed textures without a renderer.

## Goals / Non-Goals

**Goals:** one material path for GLB and USDZ; exact live tiling; valid core glTF; deterministic bytes for the same maps; a defined flat fallback.

**Non-Goals:** KTX2 maps in the export; project furniture resolution (unchanged); smaller-file encodings (WebP, JPEG); baked lighting or live shader patches in the export; USDZ byte determinism.

## Decisions

1. **Export context, internal.** `ExportDeps` gains an optional `getSurfaces()` returning `ExportSurfaces | null`: `{ projectMaterials, findFinish, textures, builtinTextures }`, the texture fields being `{ source, device }` without the live redraw hook. `SceneMount.exportSurfaces()` answers it from the last mount's options and the bundled source; `HandleCommands` forwards it and `viewer-api.ts` wires it into both export calls. `ViewerHandle` and the iframe protocol do not change; `viewer-app.ts` (at its line limit) is not touched. Alternative rejected: handing the export the whole builder options (would change furniture).
2. **Room-surface-only resolution.** `SceneBuilderOptions` gains `surfaceMaterials`, read by the builder context instead of `projectMaterials` when given; the asset loader keeps reading `projectMaterials`. The export passes `surfaceMaterials` and `findFinish`, not `projectMaterials`.
3. **Ordinary acquisition, then settle.** The export builder gets both texture sources; `exportGlb`/`exportUsdz` await `builder.mapsSettled()` before preparing the graph. A deferred live source is started a frame after mount, so an export after `ready` never waits on an unopened source; a source fetch has its own deadline.
4. **KTX2 out.** The export's texture handles say they take no compressed maps (`LibraryTextures.compressed: false`); a library surface given such a handle does not ask for the maps of a KTX2 material, so it stays flat and no compressed view reaches a writer. Alternative rejected: `TextureUtils.decompress` with the live renderer (GPU readback, renderer coupling).
5. **UV bake.** A new module `src/app/export-library.ts` (lazy, imported only by the export modules) first snapshots the texture matrix of every library material in the prepared graph (wall faces and default ceilings share one material across many meshes), then walks the graph in traversal order: each mesh wearing a textured library material gets a wrapper geometry sharing every attribute but a new `uv` = matrix × uv (cached by geometry and material). Only after every mesh is baked are the export's own views reset to identity. Feature-id wrappers are made from the baked geometry.
6. **Canonical textures.** After baking, the module maps each view to one canonical view per (image source, colour space) and reassigns material slots, so the GLB writer writes one texture per image and one flipped normal per normal image. When a material's metalness and roughness maps are different images (an ARM plus a separate roughness map), the module packs them once per (metalness source, roughness source) into one texture (G roughness, B metalness, as three's writer packs) and puts it in both slots, so three's per-material packing never runs.
7. **Tint bake.** For a material whose colour factor has a component above 1, the module draws the colour image to a canvas, multiplies every texel in linear light by the factor, clamps, encodes sRGB, keeps alpha, and uses the result as the colour map with a white factor; derived images are cached by (image source, factor) and released after the write.
7a. **Flat factors clamped.** A library material left without a colour map (missing albedo, KTX2, no viewer) has its colour clamped per component to 1 for the export only; the live material is not touched (the export builds its own).
8. **Orientation.** No flip is added: the decoded bitmap is written as stored for a `flipY = false` view, the GLB keeps UVs, USDZ writes `1 - v`; both sample the live texels. A component test reads back an asymmetric map to prove it.
9. **Size.** Images are PNG as the writers encode them, at the live size (512 px on a mid-class device, 768 px on a high one). Measured on the demo apartment (bundled finishes only): without texture sources (as before this change) the GLB is 13.60 MB and the USDZ 17.97 MB; with the maps at 256 px +0.75 MB / +0.90 MB, at 512 px (mid device) +2.96 MB / +3.11 MB, at 768 px (high device) +6.86 MB / +7.01 MB. Each export took under one second on a GPU machine.

## Risks / Trade-offs

1. [Files grow by several MB of PNG] → measured on the demo apartment; WebP or JPEG encodings are a later, separate decision.
2. [Texels above 1 after a tint bake clip] → only where the live factor already makes the reflectance exceed 1; documented in the spec.
3. [The USDZ writer has no tangent-less normal correction] → the export turns the green channel of library normal maps for USDZ, as the GLB writer does for glTF: both formats store the live bitmap, whose rows run bottom-up through the picture, and sample it identically, so both need the same correction to keep the maps' OpenGL convention.
4. [An export that draws a finish never shown fetches it] → the same source, resolver, budget and deadline as live; no new location.
5. [Export time grows with image encoding] → component tests use the small L-shape plan where possible; the demo apartment runs only in the conformance test.
