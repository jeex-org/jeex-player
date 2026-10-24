# Tasks

TDD: every task writes or extends its test first, sees it fail, then makes it pass. One temporary commit per task.

## 1. Ceiling hanging, fact, units, build, upgrade, collect

- [x] 1.1 Non-builder ceiling bodies (stand-in, GLB) hang from the ceiling plane, offset down by their own height; builder ceiling bodies unchanged. Tests first in `src/geometry/asset-loader.test.ts` and `src/geometry/scene-builder.test.ts`: a 1.052 m pendant project object (placement `01a15f1b-dbbd-7657-ab60-6f840ab91f11`, archetype `01a12fdf-14e8-7bc8-8007-8ba4894f374a`, 2.65 m ceiling) has its stand-in and GLB in the same world box with the top at 2.65 m; a bank pendant's body and world box exactly as before; walk obstacles, plan facts and the layout lint of ceiling items identical before and after, and matching the drawn box. Verify: those files and the walk, plan and layout-lint test files green.
- [x] 1.2 Fixture `tests/fixtures/project-lamps/project.json` (table lamp and pendant) with a one-room scene and two stand-in GLBs; ids in `tests/fixtures/project/fixture-ids.ts` (`LAMP_PROJECT_FIXTURE`). Tests first in `src/assets/project-fixture.test.ts`: the manifest parses, the scene validates against its library. Verify: red before 1.3, green after.
- [x] 1.3 Schema (design 1). Tests first in `src/assets/project-manifest.schema.test.ts`: every scenario of `lamp-light-fact` «Lights are an optional variant fact», «Point light shape», «Light count, identity and decay», «Validation refuses the manifest», paths asserted.
- [x] 1.4 Units (design 2). Tests first in `src/lighting/lamp-units.test.ts` and `src/lighting/index.test.ts`. Verify: `bun scripts/lighting-entry-check.ts` passes.
- [x] 1.5 Resolver: `ResolvedAsset.lights`. Test first in `src/assets/asset-resolver.test.ts`.
- [x] 1.6 Loader (design 3). Tests first in `src/geometry/asset-loader.test.ts`: «Lights are built on the first body», «No light without a fact», «Fact lights carry their source», «Shadow hint carried, not cast», «Mirroring follows the body».
- [x] 1.7 Upgrade and swap (design 4.2, 4.3). Tests first in `src/geometry/scene-builder.test.ts`: same object and positions after the upgrade, placement scale 1.5, tint and bake mark kept, foreign light dropped with `light-in-model`, variant swap to an unlit and to a lit variant under 3000 K.
- [x] 1.8 Bake marks: test first in `src/lightmap/lightmap-binding.test.ts`; no production change expected.
- [x] 1.9 Collect (design 5). Tests first in `src/render/lamp-lights.test.ts`: every scenario of «Collect lamp lights for the bake». Verify: the module touches no DOM.
- [x] 1.10 Component test (Vitest browser, mount tier): mount the lamp fixture, wait for the models to settle, each lamp holds one tagged light with the current temperature applied.
- [x] 1.11 README (the fact, the model frame, the units with the nominal-lumens note, the ceiling hanging, the known costs and limits) and CHANGELOG. Verify: `bash scripts/no-docs-refs.sh` clean.
- [x] 1.12 Acceptance: `bun run typecheck`, `bun run lint`, `bun run format:check`, `bash scripts/check.sh fast`.
