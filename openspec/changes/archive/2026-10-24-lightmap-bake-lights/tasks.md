# Tasks

## 1. Bake-lights contract

- [x] 1.1 Write `src/lightmap/bake-lights.schema.test.ts` (accepts a well-formed answer unchanged and an empty lamp list; refuses an unknown recipe, sky recipe or key, a non-unit sun, negative colour, strength or radiance, a non-UUID-v7 or repeated lamp id, a power that is not 4π × intensity, a non-finite position) and see it fail on the missing module
- [x] 1.2 Write `src/lightmap/bake-lights.schema.ts` (recipe ids, `BAKE_LAMP_WATTS_PER_CANDELA`, `judgeBakeLights`) and verify the schema test passes

## 2. bakeLights

- [x] 2.1 Write `src/lightmap/bake-lights.test.ts` against live objects (apartment rig built with a stub renderer and aimed by `prepareSunShadow`): sun direction for the demo apartment and a sited one, sun colour and strength, sky at up-facing and tilted normals, the hemisphere axis, determinism; see it fail on the missing module
- [x] 2.2 Write `src/lightmap/bake-lights.ts` and verify the test passes; verify by mutation that a flipped sun, a missing /π, an ignored site and an interior factor each fail a test
- [x] 2.3 Test-first: refuse while three's colour management is off
- [x] 2.4 Test-first: lamps only through the lamp-lights seam: bank bulbs are never listed (the demo apartment answers no lamps), a stand-in collector is called once with the built scene and its lights are mapped field by field (id, index, position, colour, candela, power 4π·cd) in its order; then the stub `src/render/lamp-lights.ts` (type `LampLight`, `collectLampLights` answering none) and the mapping; mutation: bypassing the given collector fails
- [x] 2.5 Test-first: the bank is a required argument (`@ts-expect-error` on a call without one, which also throws), `SHIPPED_BANK` builds every placement and a bank that resolves nothing builds none; mutation: ignoring the bank fails
- [x] 2.6 Schema: lamps carry `index`, `(id, index)` unique; test-first in `bake-lights.schema.test.ts`

## 3. Sidecar lights record

- [x] 3.1 Test-first in `light-bake.schema.test.ts`: a sidecar with `lights` and a `{ upper, lower }` sky passes; another recipe, sky recipe, standard version 0 or extra key is refused naming the field; then add `lights` to `light-bake.schema.ts` and `light-bake.ts` (the schema/type agreement test stays green)
- [x] 3.2 Test-first in `baked-shell.test.ts`: an apartment sidecar without `lights` is refused; then require it in `verifiedSidecar` and give the stand-in sidecar (`src/fixtures/shell-unwrap.ts`) the record; verify `baked-shell`, `light-bake-load`, `lightmap-binding` and `shell-export` tests pass

## 3b. Shell export finishes

- [x] 3b.1 Confirm the defect on the old code: a project material under a bundled finish id, exported with materials but no lookup, gives the bundled albedo under the same digest as the live composition
- [x] 3b.2 Test-first in `shell-export.test.ts`: a call without `finishes` is a type error and is refused; the project's albedo reaches the export with `projectFinishes`, not with `SHIPPED_FINISHES`; then `src/materials/project-finishes.ts`, `project-wiring.ts` on it, required `finishes` in `shell-export.ts`, every caller updated; verify `bun test src/lightmap src/app src/materials` and the typecheck

## 4. Seams replaced later (not in this change)

- The stub body of `collectLampLights` is replaced by the lighting work that gives placements light descriptions; `bakeLights` and its output keep their shape.
- The local 4π·cd conversion in `bake-lights.ts` is replaced by the lighting module's published conversion once it exists.

## 5. Integration

- [x] 5.1 Fast-tier checks green (its static steps run directly after one lint fix; the bun tests run in 5.2)
- [x] 5.2 Run the standard tier once through the heavy-run queue (it includes the component test that uses the stand-in sidecar) and verify it is green; on red, re-run only the failed files
- [x] 5.3 Run `openspec validate --all --strict` and verify it passes
- [x] 5.4 Verify the module is not public: no `package.json` export, lib build entry or `src/embed` / `src/lighting/index.ts` import reaches `src/lightmap/bake-lights*` (`grep -rn bake-lights package.json vite.lib.config.ts src/embed src/lighting/index.ts` finds nothing)
