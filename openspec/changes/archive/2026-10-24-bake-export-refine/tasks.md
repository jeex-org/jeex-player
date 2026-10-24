# Tasks

## 1. Lamp power from the lighting module

- [x] 1.1 Golden test of `bakeLights` lamps (demo, stand-in collector) recorded before the change; red test: the schema module exports no lamp power constant. Verify: the red test fails first, then `bun test src/lightmap/bake-lights` green.
- [x] 1.2 Import `blenderPower` in `bake-lights.ts` and `bake-lights.schema.ts`, remove the copies, update the module docs. Verify: 1.1 green, golden unchanged.
- [x] 1.3 Ceiling-lamp test: lamp project fixture, GLB upgrade, bulb position equals the bake lights' before and after; document the assumption in `bake-lights.ts`. Verify: `bun test src/lightmap/bake-lights`.

## 2. Triangle record in the builders

- [x] 2.1 Red tests for `shell-unseen.ts` and the demo classes (floors, wall backs/bottoms/caps, skirting, joints, nothing on ceilings/openings/site/tops), and a jog-vs-continuation fixture. Verify: fail first for the missing module/record.
- [x] 2.2 `shell-unseen.ts` and the recording in `shell-builder.ts`. Verify: 2.1 green; existing shell builder and screenshot-free tests green.

## 3. Export and contract

- [x] 3.1 Red tests: schema accepts `unseen: true` on the four kinds and refuses it elsewhere or as `false`; export writes seen/unseen pairs, partitioned world triangles, deterministic bytes, digest unchanged; counts and unseen area share on the demo. Verify: fail first.
- [x] 3.2 Schema field, `shellParts` in the contract, the split in `exportShellForBake`, docs. Verify: 3.1 green.

## 4. Loader and adoption

- [x] 4.1 Red tests: UV1 on an unseen node refused before pages; a binding naming an unseen part refused; an unsplit file refused; round trip with the stand-in unwrap skipping unseen parts keeps behaviour, partitioned triangles, picks, dollhouse cut/restore with children, children live and unbound; undo removes children. Verify: fail first.
- [x] 4.2 Stand-in unwrap skips unseen parts; `verifiedShellFile`, `adoptShippedShell` with children and raycast forwarding; docs. Verify: 4.1 green, `tests/component/baked-shell.test.ts` green through the heavy queue.

## 5. Integration

- [x] 5.1 `bash scripts/check.sh fast`, then the standard tier once through the heavy queue; no screenshot baseline changes. Verify: both green.
