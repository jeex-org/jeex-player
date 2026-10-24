# Design

## Context

A light bake is made by an external tool: it imports the player's export module from source in a browser, exports the shell, adds `TEXCOORD_1` (its unwrapper splits vertices at chart seams), bakes, and ships the final shell file with a sidecar. Since the room-lighting change, shell meshes have origins inside their rooms; the bake needs identity transforms (normals are baked in object space), so the export applies each mesh's world matrix and the player puts the origin back. Picking, painting, the dollhouse and openings read `userData`, including callbacks that no file can carry.

## Goals / Non-Goals

**Goals:** a shell file whose every mesh can be addressed by an id and knows what it is; a digest that pins a bake to the scene revision it was made for; a loader that uses the shipped geometry and UV1 without changing any run-time behaviour, and never applies a bake to another revision.

**Non-Goals:** a manifest field or viewer option that finds a project's bake; wiring the loader into the viewer; edits after a bake is applied; furniture lightmaps; the bake itself.

## Decisions

1. **Ids are the file's, minted by the caller.** The scene has an id per wall, room, node and opening, but not per wall side, not one for a floor apart from its ceiling, and not per part of an opening. Composing one from other ids is ruled out, and the player never mints ids. The shell file belongs to the bake tool, so the export takes `mintId` from its caller and names each node and mesh with it. The structured identity (kind and scene ids) travels in `extras`; the player never reads identity from a name.
2. **Adopt into the live shell rather than reconstruct it.** The live scene is built as today. `shellEntries` walks the live shell in build order and describes every mesh exactly as the export did; the file must match it mesh for mesh (contract and finish value; counts are not compared). Then each lit mesh takes the file's geometry and keeps its object, so its material, callbacks, parent group, paint registration, picker registration and dollhouse handling are the live ones by construction. Reconstructing meshes from `extras` was rejected: it would duplicate the paint's material resolution and the opening group structure (door leaves still come from the live opening groups). The cost is that a future change to how the builder splits the shell refuses older bakes (they fall back to live lighting) instead of breaking them.
3. **Names are not written onto live meshes.** The sun shadow finds `site-ground` by name and reads its circle radius; the skirting rebase finds skirtings by name. Adoption returns a map from file name to live mesh, and the binding resolves through it.
4. **Only meshes with UV1 take the file's geometry.** The site and glazing carry no UV1 (the bake tool leaves them unbound): they are checked like the rest and keep their live geometry.
5. **Origin placement.** For a lit mesh the geometry is shifted by `-origin` and the mesh's local matrix becomes `inverse(parent.matrixWorld) × T(origin)`. Shell meshes sit under an unrotated group, so this is a translation; opening parts sit under a group translated in the plan and rotated about Y, so their local rotation becomes the inverse of the group's. The dollhouse sets a frame part's local `y` to the middle of its band, which equals the origin's `y` because the group stands at `y = 0`.
6. **Digest over scene inputs, not over output.** `shellInputsHash` reads the plan, scene-local materials, finishes and the named project materials through a canonical JSON. A digest of the built output would turn every change of the player's shell code into a refused bake. Furniture, cameras, tours and names stay out; the sidecar's `contentHash` is the bake's broader dependency.
7. **Check order is cost order.** Sidecar, shell bytes against `shellHash`, scene id and the three digests, then the file's JSON against the contract, all before a page is fetched (`loadLightBake` takes a shell check that runs before pages). Adoption and binding are one transaction.
8. **Own GLB writer.** The file must carry exactly the contract and be deterministic; three's exporter writes every `userData` key. `GLTFLoader` reads the file after its JSON is judged.
9. **Albedo from the finish value.** Library materials change colour when their maps arrive, so the export takes the first-frame colour of the finish value (average colour, tinted for tintable materials); fixed-colour surfaces use their material colour, glazing its tint.
10. **Opening materials say what they are.** Frame materials record their finish id and glazing records that it is glass, in material `userData` at creation; this is how the contract tells glass from a frame without parsing names.

### Kinds the bake lights

| Kind | In the bake | UV1 and binding |
| --- | --- | --- |
| floor, ceiling, wall, skirting, joint | yes | yes |
| opening frame or sill (any type) | yes | yes |
| opening `glass` | no (passes sky and sun) | no, stays live |
| site slab and ground | occluder and bouncer | no, stays live |
| `visible: false` | no | no |
| `castShadow: false` and visible | not an occluder | yes |

## Risks / Trade-offs

- [The builder's mesh split changes in a later release] → older bakes are refused and the apartment shows live lighting until it is baked again; never a wrong bake.
- [Adopted meshes keep the old geometry for undo] → about twice the shell's vertex memory while a bake is applied; the shell is small next to furniture.
- [Library maps that land after binding go to the source material, not the bound clone] → the viewer wiring must bind after the library maps settle; this change has no viewer entry, so nothing binds early today.
- [Scene edits after binding] → repaint and opening swaps change shell inputs; the viewer wiring must drop the bake before such an edit.
- [Export size] → the demo apartment's file is about 0.8 MB with 32-bit indices and no quantisation; the bake tool's final file is what ships, and its size is measured in the next step.

## Public shape for the wiring step (proposal, not built)

A project manifest field `lightBake?: { sidecar: string; shell: string }` (URLs next to the published revision), read by the scene mount after the scene is built and the library maps have settled; on `applied: false` the viewer logs the reason and keeps live lighting.
