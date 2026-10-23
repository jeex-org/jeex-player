# Tasks

## 1. Operation

- [ ] 1.1 Add `SetSiteOp` to the scene operation types and its zod schema (strict, at least one key, field-named errors), with the compile-time agreement check; verify `types.schema.test.ts` for each bad-value scenario.
- [ ] 1.2 Implement `set_site` in the dispatcher test-first, testing pure `applyOp` directly as well as `SceneModel.apply` (set, clear one, clear both removes `site`, normalisation including -90 → 270, 720 → 0, -0 → 0 and a tiny negative never giving 360, bad values refused by the applier, empty refused, 2.2 refused, version unchanged); verify `scene-ops.test.ts`.
- [ ] 1.2a Add the touched kind `site` to every touched table (editor and scene-builder handlers, touched text, equality) and to the scene diff; the live mount keeps re-aiming through its revision path; verify the touched and diff tests.
- [ ] 1.2b Refuse `set_site` inside interior presets in the preset validator; verify its test.
- [ ] 1.3 Export `SetSiteOp` from `jeex-viewer/ops` with its documented list and export-surface test (three-file change); add a post-generation rule in `scripts/schema-gen.ts` so the published `SceneOp` schema requires at least one of `northDeg`/`sun` for `set_site`, matching the zod schema; verify `schema-gen.test.ts` and the ops tests.

## 2. Live and docs

- [ ] 2.1 Browser test (heavy queue; extend an existing sun-shadow file rather than adding one): the debug `applyOps([{ op: 'set_site', sun: 'morning' }])` re-aims the sun and refits the shadow without a reload; a second `set_site` with the previous values restores the previous direction; verify that file.
- [ ] 2.2 README (scene operations and the scene-format text on how `site` is written) and CHANGELOG; verify docs tests.
