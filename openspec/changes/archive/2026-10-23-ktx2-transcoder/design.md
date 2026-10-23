# Design

## Context

See proposal.md for the motivation. Today GLBs load through a lazily imported `GLTFLoader` with the meshopt decoder (`src/geometry/model-source.ts`); room maps are fetched, capped and decoded with `createImageBitmap` in `src/materials/texture-source.ts` and drawn with one texture matrix per material (`src/materials/library-uv.ts`). three ships the Basis transcoder as `examples/jsm/libs/basis/basis_transcoder.{js,wasm}`; its `KTX2Loader` declares default URLs for them with `new URL(…, import.meta.url)`, which a library build inlines as base64.

## Goals / Non-Goals

**Goals:** KTX2 furniture and room maps drawn with the same look and orientation as WebP; one location rule for every embed shape; the transcoder off the boot path and fetched at most once per viewer.

**Non-Goals:** encoding, store QC, measurement; a host override of the transcoder folder (proposed for clearance, not built); a deadline on transcoding.

## Decisions

1. **Build plugin** (`scripts/basis-transcoder-plugin.ts`, used by `vite.config.ts`, `vite.lib.config.ts` and `vitest.config.ts`). It replaces KTX2Loader's two default-URL constants with `''` (and fails the build when three changes those lines), emits the pair as `lazy-jeex-viewer-basis-transcoder-<hash>.{js,wasm}` beside the chunks (`dist-lib/`, `dist/assets/`), defines the hash for the bundle (`__JEEX_BASIS_TRANSCODER__`), and answers any path ending in a transcoder name on the dev server. The hash is the first eight base64url characters of SHA-256 over both files, so the pair always changes together. Alternative: Vite's `?url&no-inline` asset import, rejected for needing a second mechanism in the IIFE.
2. **Location**: `new URL(<published name>, <own file URL>)`. The own file URL is captured once while the bundle evaluates (`import.meta.url`, else `document.currentScript.src` in the IIFE) by one shared module that the telemetry's own-file check also reads. A KTX2Loader loading manager rewrites three's fixed names (`basis_transcoder.js`, `.wasm`) to the published ones.
3. **One transcoder per viewer** (`src/materials/ktx2.ts`): created by the composition root with a getter for the stage's renderer; on first use it imports `KTX2Loader` and three's `ktx-parse`, configures the loader (`setTranscoderPath`, `detectSupport(renderer)`, one worker), awaits `init()` and caches the promise; a rejected start is not cached, so the next KTX2 asset tries again (the request count is therefore exactly one per file for a viewer whose start succeeded first time). `dispose()` ends the worker pool with the viewer. Context restoration keeps it: the renderer object survives a restore and the workers are CPU-side.
4. **GLB path**: the container's `extensionsUsed` is read with the other pre-parse fields; only when it lists `KHR_texture_basisu` does the source await the transcoder and call `setKTX2Loader`. A start failure is a `scene-load` refusal with reason `ktx2-transcoder`, before the parse. Because `init()` only fetches the files (workers are created during the parse) and three turns a texture failure inside the parse into a silent `null`, each parse hands `GLTFLoader` a thin per-parse wrapper around the shared loader whose `load` records any reported error; a parse that recorded one is disposed and refused with the same reason. A worker that never answers is not detected (no deadline, see Risks). KTX2 images embedded in the GLB are fetched by the KTX2 loader's own manager (as `blob:` URLs); containment of URIs named by the container is still enforced by the pre-parse scan. `disposeScene` now also disposes every texture a parsed material holds.
5. **Room maps**: a `.ktx2` path is decoded by the transcoder instead of `createImageBitmap`. Before transcoding, the container is read: one 2D image, one layer and face, a Basis payload (ETC1S with BasisLZ, or UASTC with or without Zstd), square at the named size, orientation `rd` when stated. The bytes kept for the document are copied before transcoding (the worker takes ownership of what it is given). The shared decoded image carries the mip payload, format and type; each surface's view is a `CompressedTexture` over the same `Source` with the same payload, repeat wrapping, the WebP path's anisotropy, no mipmap generation, mipmapped filtering when the file has more than one level. The colour space is set by role; a container transfer function that disagrees warns (`texture-colour-space`).
6. **Tint is format-blind**: a KTX2 `albedoTint` is drawn exactly like a WebP `albedoTint` (the same colour factor and first-frame colour, including any recipe factor the tint maths carries); the format only decides the texture transform and the normal-scale sign below.
7. **Orientation**: a KTX2 material (all of its files end in `.ktx2`, a schema rule) gets the texture matrix with its v row negated and `normalScale.y` negated after the strength is applied. With repeat wrapping `-v` and `1 - v` sample the same texel, and a reflection keeps the footprint for mip selection and anisotropy. glTF textures are untouched.
8. **Budget**: the gate also measures `.wasm` files (always lazy). New lazy lines: the KTX2 loader chunk, the transcoder JS and the transcoder wasm, each at its measured size plus 1 KB. The IIFE carries the loader code inline (it cannot split), inside its existing 700 KB budget.

## Risks / Trade-offs

- [A host serves the library build without `.wasm`] → KTX2 GLBs keep their procedural bodies and KTX2 room maps stay flat, with one warning each; the README states the file types to serve.
- [A host rebundles the ES module] → the own file URL is the host's chunk; the README says to copy the pair next to it. A host override is proposed for clearance.
- [A strict CSP blocks the `blob:` worker or wasm compilation] → the same degradation; a worker that never starts leaves the asset pending rather than failing, so no warning appears (no transcoding deadline is built). The README lists `worker-src blob:`, `'wasm-unsafe-eval'` and `connect-src` for the transcoder folder.
- [three changes KTX2Loader's default-URL lines] → the plugin fails the build with the reason.
- [Two viewers on a page] → two loaders, two workers; three logs its multiple-loader advisory once.

## Migration Plan

None: WebP documents are unchanged; KTX2 documents were refused before.
