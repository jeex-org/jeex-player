# jeex-player: agent rules

JEEX Player is the embeddable 3D apartment player (package and element `jeex-viewer`). This file is
for coding agents working in this repository. `CONTRIBUTING.md` is the full guide for every
contributor (setup, the gate, code style, the public contracts); everything there applies, and this
file adds only what an agent tends to get wrong.

1. **The player plays.** It renders, walks and tours a scene document or a baked project it is
   given, and validates what it reads (`zod/mini` at every boundary: scene, manifest, protocol,
   options, telemetry). It mints no ids: every entity id in a scene or a manifest is a UUID v7
   chosen by whoever wrote the document, and the player only checks its shape. Editing operations
   (`jeex-viewer/ops`) change a document the caller owns; new entities arrive with the caller's ids.
2. **Layers.** `src/` is split into layer directories; `.dependency-cruiser.cjs` lists them from the
   lowest (`lighting`, `shared`, `scene/types`, `plan`) to the highest (`app`, `embed`) and allows
   imports downwards only, with no exceptions. The pure modules listed in `src/purity.test.ts`
   (plan solver, navigation, scene model, catalogues) never reach `three`.
3. **Text the visitor reads lives in the catalogues.** English in `src/shared/messages.ts`, the other
   shipped locales in `src/ui/locales/`; every catalogue carries every key. A module below `ui`
   takes the resolved sentence from its caller instead of keeping strings of its own.
4. **Tests first.** A change starts with a test that fails for the intended reason (a colocated
   `src/**/*.test.ts` for logic, `tests/component` for DOM components, `tests/e2e` for whole-page
   behaviour); then the code that makes it pass.
5. **The gate.** `bash scripts/check.sh fast` while working (or only the test file you are writing),
   `standard` before a commit, `full` (the default) once before a pull request. A red gate is
   answered by re-running the failed file (`bun test <file>`, `bunx vitest run <file>`,
   `bunx playwright test <spec>`), not the whole gate. The demo build and the library build have
   size budgets (`npm run check:budget`, `npm run check:budget:lib`); a new runtime dependency
   needs an issue first.
6. **The public surfaces** (entry points, `ViewerOptions`, the handle, the iframe protocol, the
   scene and project formats, the theme properties and shadow parts) are listed under «Contracts
   to keep» in `CONTRIBUTING.md`. Changing one means `README.md` and `CHANGELOG.md` in the same
   change.
7. **Language and spelling.** Everything in the repository is English with British spelling
   (`scripts/spelling-check.ts`); demos and fixtures use invented, market-neutral places and names.
8. **The repository explains itself.** The pre-commit hook and every gate tier run
   `scripts/no-docs-refs.sh` (no path into a documents folder outside this repository) and
   `scripts/no-internal-words.sh` (no words of a private working process). A design note says what
   was decided and why, not who asked or which machine ran what.
9. **Local servers.** `npm run dev` serves the demo on port 3700, the e2e suite uses 3701 and the
   component tests 3702; a new server takes another port of 3700–3709, with `strictPort`.
10. Do not commit, push, tag or publish unless the person you work for asked for that step.
