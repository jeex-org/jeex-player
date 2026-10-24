# Tasks

## 1. Red test

- [x] 1.1 Add `src/geometry/glb-variant-materials.test.ts`: a one-object project with generator `library.materials`, an object whose `defaultFinishes` and variant `finishes` name them, and the committed box-sofa GLB repacked in the test with a `metal` material (0.9 / 0.3) and a `top` material (roughness 0.28, clearcoat 0.35 / 0.22), parsed by the real model source; assert after `upgrade` that the meshes keep those values, that a placement `finishes` override and a `material` shortcut change none of them, that no `unbound-material` warning is reported, and that `variantsForPlacement` over `projectBank(...).variants` still lists the declared finishes; verify the material assertions fail on the current code
- [x] 1.2 Flip the resolver tests that pin the old rule (a builder-less GLB variant that declares finishes, on either layer, is baked), update the `bakedObject` fixture comment, and add the builder-archetype case (a builder archetype with a model that declares finishes is not baked) and the archetype-model fallback case (a builder-less variant without its own model, under an archetype model, is baked); verify the flipped ones fail on the current code. Requirement 3 stays pinned by the existing GLB body test "a body that is not baked still swaps by slot"
- [x] 1.3 Run `bun test` on both files and record the failing assertion line
- [x] 1.4 Commit as `wip: red store variant GLB materials` with the failing assertion line in the body

## 2. Code

- [x] 2.1 Change `isBakedVariant` to the rule in the design (GLB and no builder, or GLB and no declared finish) and update its doc comments and `ResolvedAsset.baked`; verify the tests of group 1 pass with `bun test src/assets/asset-resolver.test.ts src/geometry/glb-variant-materials.test.ts`
- [x] 2.2 Update the README project format note on baked variants; verify `bash scripts/check.sh fast` is green
- [x] 2.3 Commit the code as its own commit after the red one

## Workflow follow-up

- One full gate through the gate queue after the review answer commit and the rebase; on red, re-run only the failed files.
- Archive the change, move the internal process notes out of the repository, set the archived change to the stock schema and run `openspec validate --all --strict`.
- Code review and security review over the branch diff; fixes land as one red/code pair.
