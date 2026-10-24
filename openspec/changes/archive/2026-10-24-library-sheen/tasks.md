## 1. Red tests

- [x] 1.1 Schema tests: `sheenRoughness` refuses -0.01, 1.01 and non-finite values and accepts 0 and 1 (`src/assets/project-manifest.schema.test.ts`).
- [x] 1.2 Material tests on one cloth material (`src/materials/library-material.test.ts`): stated `sheen`, `sheenRoughness`, `sheenColour` reach `MeshPhysicalMaterial`; `{ sheenRoughness: 0.6 }` joins the existing per-field promotion list; a tintable `luma-mid@1` scan with sheen and no colour takes the plain finish colour (not times the recipe gain), and its first suggested colour without a finish colour; a natural scan takes white.
- [x] 1.3 Run both files, see them fail on the missing field and default; commit as `wip: red library-sheen` with the failing line in the body.

## 2. Code

- [x] 2.1 `sheenRoughness` in `libraryPbrSchema` and `LibraryPbr`.
- [x] 2.2 `sheenRoughness` in `PHYSICAL_FIELDS`; `applyPhysical` sets `sheenRoughness` and the sheen colour default from the draw's tint, else white.
- [x] 2.3 README library material reference: the type block, the ranges line and the physical-field list under Drawing, with the sheen colour default and the sheen roughness default of 1.
- [x] 2.4 `CHANGELOG.md` `[Unreleased]`: the new field and the sheen colour default.
- [x] 2.5 Fast tier green; both test files green; commit the code separately.

## 3. Integration

- [ ] 3.1 Review of record over the branch diff and a security review; fixes in one answer commit.
- [ ] 3.2 Rebase on the main branch, then one full gate through the gate queue; a red file is re-run alone, never the whole gate.
