# Tasks

Each behaviour lands as a pair of commits: a red test commit whose body quotes the failing line, then the code.

## 1. Authoring script and index

- [x] 1.1 Red tests in `scripts/finish-maps-fetch.test.ts`: an alias row becomes an index entry `{ finish, slug, alias }` and fetches nothing; a row with two modes, a duplicate finish id, an alias to a missing, pending, alias or self target are refused before any fetch; an alias as the ceiling default is refused; two rows with different facts for one version are refused; a bound entry turning into an alias, a kept entry turning into an alias and a changed tint each need `--update` and are printed; the index entry of a bound row carries the mapping's `name`.
- [x] 1.2 Schema (`finish-maps-index.schema.ts`) and script changes.

## 1a. Rectangular maps

- [x] 1a.1 Red tests: the script accepts a 256 by 128 rendition of a 3.6 by 1.8 m tile and refuses one whose aspect differs from the tile's; the texture source draws a 256 by 128 file listed as 256 and still refuses 500 by 512 listed as 512.
- [x] 1a.2 The script's size check and the decode check in `texture-source.ts`.

## 2. Re-fetch, table and catalogue rows (one code commit)

- [x] 2.1 Red tests in `scripts/finish-maps.test.ts`: no kept entry; the alias entries equal `RETIRED_FINISHES`; every catalogue row id and alias id is listed once; every bound row's name equals the index name; the eleven new ids are bound; the zellige binding carries clear coat 1 and clear-coat roughness 0.08; the default ceiling is tinted `#f1ece2`; the porcelain repeats are 3.6 by 1.8 m (6 by 3 tiles of 0.6 m) and the limestone repeat 3.72 m (6 tiles of 0.62 m). Red tests in `src/materials`: `findFinish` and `finishKind` of each alias answer the target's own `Finish` and family; the picker lists contain no alias and contain the eleven new ids in their family, after the existing rows; the slug table keeps `ash`, `wallpaper-cream`, `wallpaper-sage` on their alias ids.
- [x] 2.2 Re-fetch with `--update` against the local store (key only in that command's environment); regenerate the table and `SOURCES.md`; `FINISH` literals of the new ids copied from the mapping; catalogue rows (new rows, names from the mapping, `base` = first-frame colour, alias rows removed from the lists) and `RETIRED_FINISHES`.
- [x] 2.3 Red test, then `FINISH_MAPS_BUDGET_BYTES` = measured emitted folder + 5 %; the per-file and all-at-768 caps unchanged.

## 3. Resolution and document preservation

- [x] 3.1 Red tests: `resolveRoomFinish` of an alias draws the target's binding with the alias as draw id; a project material under the alias id wins; a project material under the target id only does not reach the alias. A document with Cream stripes walls, after an unrelated edit, serialises (`SceneModel.toJSON`) with Cream stripes still on those walls, and its walls resolve to Warm white's library draw.
- [x] 3.2 `bundledAliasTarget`, `resolveRoomFinish`.

## 4. Public alias table

- [x] 4.1 Red test in `src/embed/ops.test.ts`: `FINISH_ALIASES` and `FINISH_NAMES` are in the export list; `FINISH_ALIASES` maps the three alias ids to their targets; `FINISH_NAMES` names every floor and wall row as the picker does (Mocha for graphite) and holds no alias; both frozen with a null prototype.
- [x] 4.2 Export, the entry's header list, README ops section; `build:lib`, then `OPS_BUDGET_FAIL_BYTES` = measured ops entry + 1 KB with its comment updated.

## 5. Picker

- [x] 5.1 Red tests: a wall wearing Cream stripes shows Warm white as current (in `finishCore` and in `describeSelection`), lists no alias, and its scope operations name Cream stripes; the built-in footer without a pick applies Cream stripes; after a pick of Warm white the footer applies Warm white; a project material under the alias id keeps the alias as current.
- [x] 5.2 `selection-options.ts` and `panel-requests.ts`.

## 6. Clear coat and frames

- [x] 6.1 Test: a zellige draw becomes a `MeshPhysicalMaterial` with clear coat 1 and clear-coat roughness 0.08. Green on arrival is expected; prove it by mutation (drop `clearcoat` from `PHYSICAL_FIELDS` for one run) and say so.
- [x] 6.2 Test: an opening variant framed in the graphite finish draws its frame in the graphite row's `base` (the Mocha first-frame colour).

## 7. Demo, consumers, docs

- [x] 7.1 Red test, then demo presets off the retired ids with their new names.
- [x] 7.2 Update bun tests that pinned old colours, names, kept stripes or tiled repeats to the approved mapping; name each in the report. Remove the tests of kept bundled finishes (none is kept); the kept code path stays for an index that keeps one.
- [x] 7.3 Browser tests that read pixels on bundled finishes (`walk-lighting`, `export-gltf`, `swatch-preview`, `plan-modes`, `render-on-demand`, `library-material`, `builtin-textures` component tests) run one by one through the heavy queue after 2.2; expected numbers re-measured where the new looks move them, nothing in the lighting code changes.
- [x] 7.4 README paragraph on the bundled finishes and the ops export, CHANGELOG entry (new public export, host `current` for an alias).

## 8. Integration

- [x] 8.1 Fast tier while working; failed files re-run alone through the heavy-run queue.
- [x] 8.2 Archive, then code review and security review over the branch diff, one answer commit as a red/code pair.
- [x] 8.3 Rebase on the main branch, then one full gate through the gate queue; a red gate is answered per failed file.
