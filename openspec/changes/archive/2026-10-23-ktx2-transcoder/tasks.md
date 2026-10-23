# Tasks

Every task is red-green: its focused test is written first and seen failing, then the code, and the test lands in the same commit as the work. Browser tests and whole suites run only through the machine's heavy-job queue (Playwright at most 2 workers, Vitest at most 4).

## 0. Prerequisite

- [x] 0.1 Rebase onto `main` with the library tint fix; read its colour-factor and first-frame maths so KTX2 `albedoTint` reuses it unchanged.

## 1. Fixtures

- [x] 1.1 `scripts/make-fixture-ktx2.test.ts` first, then `scripts/make-fixture-ktx2.ts` (PNG pictures encoded with `ktx create` at the bake's settings) and its outputs under `tests/fixtures/ktx2/`; the test checks each file is a Basis KTX2 of its named size with a full mip chain and small (`bun test scripts/make-fixture-ktx2.test.ts`).
- [x] 1.2 Extend `scripts/make-fixture-glb.test.ts`, then `scripts/make-fixture-glb.ts`, to build `tests/fixtures/project/obj/box-sofa-basisu@1.0.0.glb` (the box sofa with UVs and a `KHR_texture_basisu` base colour from `swatch.16.ktx2`); the test compares the committed file with a fresh build.

## 2. Build plugin and budget

- [x] 2.1 `scripts/basis-transcoder-plugin.test.ts` first: default-URL neutralisation and its failure on a changed source, hashed names (one hash for both files), dev-server name matching; then the plugin (`bun test scripts/basis-transcoder-plugin.test.ts`).
- [x] 2.2 Wire the plugin into `vite.config.ts`, `vite.lib.config.ts` (every pass that bundles the viewer) and `vitest.config.ts`; declare `__JEEX_BASIS_TRANSCODER__`; verify `bun run build:lib` and `bun run build` emit the pair and no `data:application/wasm` appears in any bundle.
- [x] 2.3 `scripts/budget-check.test.ts` first for `.wasm` measurement, then the gate and lazy limits for the KTX2 loader chunk and the transcoder pair from measured sizes (`bun run check:budget`, `bun run check:budget:lib`).

## 3. Transcoder service

- [x] 3.1 Tests first for a shared own-file URL module (ES and classic-script URLs), then the module, used by the telemetry own-file check and the transcoder location.
- [x] 3.2 `src/materials/ktx2-container.test.ts` then `src/materials/ktx2-container.ts` (container facts and the room-map checks).
- [x] 3.3 `src/materials/ktx2.test.ts` first with a stubbed loader module: lazy start once, retry after a failed start (failed-then-successful request count), name mapping, transcode with a copied buffer, per-parse error recording, dispose; then `src/materials/ktx2.ts`.

## 4. Furniture GLBs

- [x] 4.1 Tests first in `src/geometry/model-source.test.ts` and `src/geometry/glb-container.schema.test.ts`: `extensionsUsed` read; the transcoder awaited only for `KHR_texture_basisu`; a start failure and an error recorded during the parse both refuse with `ktx2-transcoder` and free the parsed scene; `dispose` frees textures. Then the code.
- [x] 4.2 Thread the transcoder from the composition root through `SceneMount`, `SceneBuilder` and `AssetLoader`; dispose it with the viewer. (As built: it travels with the texture environment the stage already hands `SceneMount`; the viewer's dispose ends it. No unit test of `ViewerApp.dispose` exists to extend; the transcoder's own dispose is unit-tested and the e2e runs exercise the wiring.)
- [x] 4.3 Component test first, then any fix it needs: the basisu fixture GLB renders its red texture through the real transcoder, and a 404 transcoder keeps the procedural body.

## 5. Room maps

- [x] 5.1 Schema tests first in `src/assets/project-manifest.schema.test.ts` (`.ktx2` accepted, one extension per material and size, mixed refused), then the schema.
- [x] 5.2 Texture-source tests first in `src/materials/texture-source.test.ts`: `.ktx2` decoded through the transcoder with container checks; compressed views over one shared source with the file's mip levels, no generated mipmaps, linear minification for one level; colour space by role with a mismatch warning; concurrent shared acquisition, release of one owner, final release and reacquisition without a second fetch (the kept bytes still usable after a transcode). Then the code.
- [x] 5.3 Tests first in `src/materials/library-uv.test.ts` and `src/materials/library-material.test.ts` (v row negated for KTX2 with rotations and rectangular tiles, `normalScale.y` negated after the strength, KTX2 `albedoTint` colour factor and first-frame colour equal to WebP's), then the code.
- [x] 5.4 Component tests in `tests/component/library-material.test.ts`: the KTX2 orientation marker stands upright, the KTX2 normal leaning up is lit brighter from above (and its WebP twin), the transcoder pair is fetched once and not at all for WebP-only work.

## 6. End to end, built artefacts and docs

- [x] 6.1 e2e in `tests/e2e/project.spec.ts`: the library project with `.ktx2` maps draws its maps and fetches each transcoder file once; the WebP library project fetches none; after a context loss and restore the KTX2 maps are drawn again with no network request (extend `tests/e2e/context-loss.spec.ts`).
- [x] 6.2 Built-artefact check, run by the full tier after `build:lib`: a Playwright spec that serves `dist-lib` from a second origin through request routing and mounts the ES entry, the custom element, the iframe page and the classic IIFE on a host page, each drawing a KTX2 scene, asserting the transcoder requests go to the library folder and nowhere else; it fails naming the missing build when `dist-lib` is absent.
- [x] 6.3 README: transcoder files, rebundling hosts, served file types, CSP; CHANGELOG entry.
- [x] 6.4 `bash scripts/check.sh fast` green; `openspec validate --all --strict`.

## Workflow follow-up

- Full gate through the gate queue, OCR and security review, archive: done by the orchestrator.
