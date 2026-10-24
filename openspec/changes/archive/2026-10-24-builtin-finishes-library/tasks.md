# Tasks

## 1. Shipped folder and its checks

- [x] 1.1 Red test: `finish-maps` index schema and integrity (every listed file exists with its bytes and SHA-256, the same sizes per role, the per-file cap, every catalogue floor/wall id listed once as bound or kept, the default ceiling bound or kept, a source row per scan).
- [x] 1.2 Index schema (`zod/mini`, `*.schema.ts`) and the authoring script `scripts/finish-maps-fetch.ts` (unit-tested on a stub store: signed URL fetch, WebP check, hash pin, `--update`, staging, key never written).
- [x] 1.3 Run the script against the local store with the agreed mapping. Commit `finish-maps/`, `SOURCES.md` and the generated `src/materials/builtin-library.ts`.
- [x] 1.4 Red test, then the table agreeing with `index.json`; the `base` of each BOUND catalogue row equals its library first-frame colour; ids, names and order unchanged.

## 2. Resolution and paint

- [x] 2.1 Red tests in `room-finish.test.ts`: a built-in id resolves to a library draw flagged built-in; a project material of any kind with that id wins; a kept id and an unknown id still go to the legacy lookup; the default-ceiling id never resolves from the table.
- [x] 2.2 `resolveRoomFinish` and `LibraryDraw.builtin`.
- [x] 2.3 Red tests in `shell-paint` / `library-shell` tests: a bare scene's floors, walls, facade and ceilings wear library materials; built-in maps are requested from the built-in source and never from the document source; the default ceiling is shared, survives a per-room repaint and is released once; the floor fallback resolves the default floor; junction cores are flat in the default wall's first-frame colour; no generator texture on any surface of a bound finish; a kept finish still draws its generator; a kept default ceiling keeps the builder's fallback.
- [x] 2.4 `BuilderContext.builtinTextures`, `SceneBuilderOptions.builtinTextures` (also through `rebuildAll`), `ShellPaint` changes, and `LibrarySurface` remembering its source.

## 3. Viewer wiring

- [x] 3.1 Red tests: the viewer-wide built-in source is created once, kept across documents and remounts, disposed with the viewer; it ignores `resolveTexture`; it is not created without a texture environment; missing files give one warning; a mount released before its first frame still starts the source on the next mount; attaching maps invalidates the render demand; a second document with the same finish fetches no file again (counted per version id); only the finishes on screen are fetched.
- [x] 3.2 `src/app/builtin-textures.ts` and the `SceneMount` and `ViewerApp` wiring.
- [x] 3.3 Red test, then the build plugin `scripts/finish-maps-plugin.ts` (emit in both builds, dev answers indexed files only, 404 otherwise), wired into `vite.config.ts`, `vite.lib.config.ts` (`es`, `iife`) and `vitest.config.ts`.

## 4. Picker and presets

- [x] 4.1 Red tests in `selection-options.test.ts` and `panel-requests.test.ts`: built-in swatch image for natural scans, flat chip otherwise, a duplicate id listed once, preset chips flat for built-ins, no generator call for bound finishes; kept finishes keep their generated swatch and chip; the default-ceiling id is never a picker option; the doc comment of `SelectionOptionCore.image` updated.
- [x] 4.2 The implementation in `src/ui`.

## 5. Budgets, export, docs

- [x] 5.1 Red test, then the folder budget in `scripts/budget-check.ts` (measured total + 5 %, per-file cap); measure the boot and `ops` growth.
- [x] 5.2 Test: GLB and USDZ export of a bare scene writes the oak floor in its first-frame colour without a generated texture.
- [x] 5.3 One component test in an existing browser file (`library-material.test.ts`, no new file cost): the folder next to the player file on the dev server answers a shipped map, which decodes at its listed size, and refuses an unlisted one with one warning.
- [x] 5.3a A built-build spec under `tests/built` (on the KTX2 embed pattern): the IIFE and the ES entry served from another origin find `finish-maps/` beside themselves and never call `resolveTexture` for it; with the folder answering 404 exactly one warning is logged.
- [x] 5.3b A bun test pins a literal `shellInputsHash` of a bare fixture painted with bundled finishes (equal before and after the change); the validator still refuses the default-ceiling id on a wall.
- [x] 5.3c Update the existing tests that pin old `base` colours, generator swatches or fetch counts, each named in the report.
- [x] 5.4 `package.json` `files` excludes `dist-lib/finish-maps`; README (the exact copy step for npm consumers and re-bundling hosts), `NOTICE` pointer to `SOURCES.md`, `CHANGELOG.md`.

## 6. Integration

- [x] 6.1 Fast tier while working; failed files re-run alone.
- [x] 6.2 Code review and security review over the branch diff, then one answer commit.
- [x] 6.3 Rebase on the main branch, then one full run of `scripts/check.sh`; on red, failed files only.
