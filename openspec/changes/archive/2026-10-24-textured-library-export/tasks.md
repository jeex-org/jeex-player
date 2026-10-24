# Tasks

Every behaviour change lands as two commits: first the failing test alone, then the code that makes it pass.

## 1. Room-surface resolution and export context

- [x] 1.1 `SceneBuilderOptions.surfaceMaterials`: room surfaces resolve from it, furniture keeps `projectMaterials`; verify with a bun test in `src/geometry` that room surfaces resolve a project library material from `surfaceMaterials` alone (the asset loader keeps reading `projectMaterials`, unchanged).
- [x] 1.2 `LibraryTextures.compressed: false`: a library surface does not request the maps of a KTX2 material; verify with a bun test over a fake source that records no request.
- [x] 1.3 `SceneMount.exportSurfaces()` and the forwarding through `HandleCommands` and `viewer-api.ts`: verify with a scene-mount test that it answers the mounted project's materials, finish lookup and both sources without the redraw hook, and `null` before a mount; the forwarding is proved end to end by 3.4.

## 2. Export library helpers

- [x] 2.1 UV bake: verify with a component test that a rotated non-square tile's exported UVs equal the live matrix applied to the metre UVs, that every one of several meshes sharing one material is baked with that matrix (walls and ceilings), and that the texture matrices are identity after the bake.
- [x] 2.2 Canonical textures: verify with a component test that three oak floors export one albedo, one normal and one ARM image, that occlusion and metallic-roughness name the same texture, and that a material with ARM plus a separate roughness map on three floors exports one packed metallic-roughness image.
- [x] 2.3 Tint bake: verify with a component test that every `baseColorFactor` component lies in `[0, 1]`, that a tint above range writes a derived image equal to the clamped product (sampled texels) with a white factor, that a factor in range is written as is, and that a flat fallback whose first-frame colour exceeds 1 is clamped (validator: no `VALUE_NOT_IN_RANGE`).

## 3. Export wiring

- [x] 3.1 `exportGlb` and `exportUsdz` take `getSurfaces`, build with the surface resolution and sources, await settlement, run the helpers; verify with component tests: a project library wall exports its library material, a bundled oak floor exports its three maps, no viewer gives the flat first-frame colour (existing test kept), a failed albedo keeps the factor and the other maps, a KTX2 material exports flat, and the orientation test reads back an asymmetric map's corner texels through the exported UVs.
- [x] 3.2 Determinism and conformance: the re-export test also runs with a texture context and stays byte-identical; the validator test exports the demo apartment with its bundled maps and keeps zero errors (judged warnings and infos updated with reasons only if new codes appear).
- [x] 3.3 USDZ: verify with a component test that the archive holds the map images and the floor material reads occlusion, roughness and metallic from one ARM file.
- [x] 3.4 Mounted handle: verify with component tests that `handle.exportGlb()` on a mounted bare scene writes the bundled maps and that after the live maps loaded the export makes no further request (counted by a fetch spy), that the images have the size the device class asked for, and that `handle.exportUsdz()` carries the images too; a fresh bundled source asked by an export fetches from the player's folder (the textured re-export test). The project path through the handle is the same forwarding, proved for project materials by the scene-mount test and the project-source export tests.
- [x] 3.5 Project generator over a bundled id: verify with a test that the exported wall wears the project's material.
- [x] 3.6 Measure the demo apartment GLB and USDZ sizes before and after and record them in the design's size decision.

## 4. Integration

- [x] 4.1 Update the README export section (textured library surfaces, KTX2 flat, USDZ normals note) and verify `no-docs-refs.sh` and the fast tier pass.
- [ ] 4.2 One full gate through the gate queue on the final tree; on red, only the failed files are re-run.

## Workflow follow-up

- Archive the change, clean the published-repo artifacts, validate all specs strictly.
- Review of record and security review over the branch diff; one answer commit.
