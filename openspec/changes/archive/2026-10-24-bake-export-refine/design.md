# Design

## Context

The player exports its shell for an offline bake (`exportShellForBake`), the bake tool adds UV1 and bakes, and the player adopts the shipped file into the live shell (`adoptShippedShell`) and binds the lightmap (`bindLightBake`). Adoption keeps every live mesh object and swaps only geometry and transform. Today one file node stands for one live mesh.

## Goals / Non-Goals

Goals: one lamp-power conversion; a pinned ceiling-lamp assumption; no lightmap for triangles a walk never sees, with the live shell behaving exactly as before. Non-goals: a runtime check of catalogue dims; changing drawn geometry; marking wall tops; the seam under a window (needs the wall builder to cut pier caps and fronts at sill and head height).

## Decisions

1. **Lamp power.** `bake-lights.ts` and `bake-lights.schema.ts` import `blenderPower` from `src/lighting/lamp-units.ts`; the local function and `BAKE_LAMP_WATTS_PER_CANDELA` go. Output is pinned before the change by a golden test on the demo and a stand-in collector.
2. **Ceiling lamps.** The module header and the spec state the assumption; a test builds the lamp project fixture, upgrades its models through the real GLB source and compares the pendant bulb's live world position before and after with the bake lights' position.
3. **Triangle record.** `src/geometry/shell-unseen.ts` holds a `WeakMap<BufferGeometry, Uint8Array>` (one flag per triangle, index order) with `recordUnseen` and `unseenOf`. `ShellBuilder` records the flags of each part as it builds it and concatenates them in merge order: floor = top (seen) + bottom + sides (unseen); wall face = per prism the 12 triangles of `quadPrism` (front, back, start, end, bottom, top; two each), arch spandrels seen; skirting = per box `BoxGeometry`'s 12 (+x, −x, +y, −y, +z, −z; −y and −z unseen); joint = top, bottom (unseen), sides. Face ends map to wall nodes by the nearer node to the polyline's end point; a jog is a node of two collinear walls of different thickness. Cloning drops the record, so the export reads it from the live mesh's geometry before `worldAttributes` clones.
4. **File.** Each shell entry expands into parts (`shellParts`): a seen part when it has seen triangles, an unseen part when it has unseen ones; the unseen part's extras are `{ ...extras, unseen: true }`. The export writes each part's triangles with vertices compacted in first-use order; `mintId` is called once per part. `unseen: z.optional(z.literal(true))` is added to the floor, wall, skirting and joint variants only.
5. **Loader.** `verifiedShellFile` adds unseen nodes to the nodes that stay live (UV1 refused before pages). Adoption compares the file nodes with the live entries' parts, node for node.
6. **Adoption.** For an entry whose seen part has UV1: the mesh takes the seen geometry as today; its unseen part becomes a child `THREE.Mesh` (geometry rebased by the origin, identity local transform, the mesh's material, a shallow copy of its `userData`, its shadow flags and layers mask). The parent gets an own `raycast` that runs the prototype on itself and on the child and reports the child's hits as its own with the face index offset by its triangle count; the child's `raycast` is a no-op. `named` maps the unseen part's file name to the child. `restore` removes the children, disposes their geometry (never the shared material), deletes the own `raycast` and restores as today. An entry whose seen part has no UV1 keeps its live geometry and gets no child. `shellEntries` skips a mesh whose parent is a mesh, so reading an adopted shell lists the same meshes (found by the component tests of the debug bake, which read the shell while it is baked).

## Risks / Trade-offs

1. Shell files exported before this change no longer match the expected node list and are refused (live lighting stays): bakes must be exported again. The input digest is unchanged, so the refusal is the node-list mismatch.
2. A selection tint active at the moment a bake applies is captured by the child, as the parent's clone already captures it today; the bake applies when the document settles, so this is left as it is.
3. Caps beside openings stay seen (only partly covered); they keep a small share of zero texels.
4. The child is an extra mesh during a baked walk: a few hundred triangles, one extra draw per split mesh.
