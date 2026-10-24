# light-bake-shell Specification

## Purpose
A light bake is made for one shell, so the viewer ships that shell: at bake time it exports the apartment shell as a GLB with world-space vertices, meshes named by ids that the bake tool mints, and the structured identity of every surface in glTF extras, together with a digest of the scene inputs the shell depends on. When it applies a bake, the viewer checks the shipped shell's hash and its input digest against the live scene before fetching any lightmap page, adopts the shipped geometry into the live shell meshes with their room origins re-applied, and binds the lightmap to the meshes that carry a second UV set, as one transaction. Any mismatch leaves the live shell and live lighting untouched.

## Requirements

### Requirement: Shell export

The player SHALL export the shell of a scene, built by its own builders, as a binary glTF with one root node per shell mesh in build order. Every node SHALL have an identity transform, with its mesh's world matrix applied to positions and normals, and exactly one primitive with `POSITION`, `NORMAL` and `TEXCOORD_0` and one material.

#### Scenario: World-space vertices
- **WHEN** the demo apartment is exported
- **THEN** every node has no transform and every vertex equals the live mesh's vertex in world space within 10 µm

#### Scenario: UV1 is the bake tool's
- **WHEN** the demo apartment is exported
- **THEN** no mesh carries `TEXCOORD_1`

### Requirement: What the shell holds

The exported shell SHALL hold floors, ceilings, wall faces, skirtings, junction cores, the site slab and ground, and the static parts of every opening (frames, sills, bars, glazing). Door leaves and everything under them, pick proxies, furniture and shadow-only casters SHALL NOT be exported.

#### Scenario: Leaves and helpers stay out
- **WHEN** the demo apartment, whose doors have leaves and whose openings have pick proxies, is exported
- **THEN** every kind is present and no exported mesh is a door leaf, lies under one, is a pick proxy or belongs to the furniture

### Requirement: Mesh names

Each node and its mesh SHALL be named by the same UUID v7, minted by the exporter's caller and unique in the file. The player SHALL NOT mint, derive or compose a mesh id, and SHALL never read a mesh's identity from its name.

#### Scenario: Minter supplied by the caller
- **WHEN** two exports of one scene use two different minters
- **THEN** the names differ and the extras and the input digest are identical

#### Scenario: Bad minted id
- **WHEN** a minter returns a value that is not a UUID v7, or the same value twice
- **THEN** the export fails naming it

### Requirement: Node contract

Each node's `extras.jeex` SHALL state the mesh's kind (`floor`, `ceiling`, `wall`, `skirting`, `joint`, `site`, `opening`) with the scene ids it belongs to, its run-time origin in world metres, `visible` as the full shell state draws it, `castShadow` and `receiveShadow`. An opening part SHALL carry its opening id, type, ordinal among the opening's exported parts and, when the builder names one, its part role.

#### Scenario: Ceilings are in the bake
- **WHEN** a ceiling the dollhouse hides at build time is exported
- **THEN** its extras say `visible: true`

### Requirement: Opening marks

An opening part SHALL carry `opening: 'glass'` when it is glazing, `'door'` when it frames a door (whose leaf is live), `'void'` when it frames an open passage, and no `opening` when it is a window frame or sill. No other kind carries `opening`.

#### Scenario: Marks on the demo apartment
- **WHEN** the demo apartment is exported
- **THEN** glazing is marked `glass` and casts no shadow, every other door part is marked `door`, every other window part carries no mark, and no surface outside an opening is marked

### Requirement: Material and asset contract

Each material's `extras.jeex` SHALL be `{ finish }`, the scene finish value the surface wears or `null` for a fixed colour, with the flat linear albedo (the finish's first-frame colour) as its base colour and no texture. The asset's `extras.jeex` SHALL be `{ format: 1, sceneId, shellInputsHash }`.

#### Scenario: Digest in the file
- **WHEN** the demo apartment is exported
- **THEN** the asset extras name the scene and its shell inputs digest

### Requirement: Contract schema

One schema SHALL judge a shell file's JSON and pass it on unchanged. It SHALL refuse a name that is not a UUID v7, a name used twice, a mesh named apart from its node, a node with a transform or children, a missing `TEXCOORD_0`, more than one primitive, an unknown kind or key, a missing origin or finish, a digest of another grammar, and a scene that does not list every node once in order.

#### Scenario: The export passes its own contract
- **WHEN** the demo apartment's export is judged
- **THEN** it passes unchanged

#### Scenario: Each rule names its field
- **WHEN** a file breaks one of the rules
- **THEN** it is refused with a message naming the field

### Requirement: Shell inputs digest

`shellInputsHash` SHALL be `sha256:<hex>` of a canonical JSON (keys sorted at every level, arrays in order) of the plan (`units`, `storey`, `ceilingHeight`, `nodes`, `walls` without `role`, `rooms` without `name`, `accent` and `purpose`), the scene-local `materials`, the `finishes`, and the project materials a room or finish value names or a surface falls back to (the default wall finish and the ceiling plaster). It SHALL NOT read a built mesh or a minted name.

#### Scenario: One shell field changes the digest
- **WHEN** a wall's thickness, the ceiling height, a node's position or a room's floor finish changes
- **THEN** the digest changes

#### Scenario: A project material replacing a default finish
- **WHEN** a project material with the default wall finish's id changes colour while no surface names it
- **THEN** the digest changes

#### Scenario: Furniture and names do not
- **WHEN** a placement moves, the scene or a room is renamed, the presentation camera moves, or a field no shell builder reads changes: a room's accent or purpose is set or cleared, or a wall's role changes
- **THEN** the digest is unchanged

### Requirement: Revision check before pages

Before the shell file is fetched, the player SHALL refuse a light bake for an apartment whose sidecar names another scene or does not carry the live scene's `shellInputsHash`. Before any atlas page is fetched, it SHALL refuse one unless the shell file's bytes hash to `shellHash` and the file names this scene and the same digest.

#### Scenario: The scene changed since the bake
- **WHEN** one shell input of the live scene differs from the baked revision
- **THEN** the bake is refused as made for another revision, only the sidecar was requested, and the live shell is unchanged

#### Scenario: Missing or disagreeing digest
- **WHEN** the sidecar has no `shellInputsHash` or names another scene
- **THEN** the bake is refused before the shell file is fetched

#### Scenario: Shell file disagreeing with the sidecar
- **WHEN** the shell file names another digest than the sidecar
- **THEN** the bake is refused before any page

### Requirement: Shipped shell matches the live shell

The player SHALL accept a shipped shell file only when it has one mesh per live shell mesh and, mesh for mesh in build order, the same contract and finish value, with one finite value per vertex in every attribute and indices that make triangles of them. Vertex and index counts SHALL NOT be compared with the export, since the bake tool may split vertices. A mismatch SHALL refuse the whole file before anything changes.

#### Scenario: Another revision of the live shell
- **WHEN** the live scene was built from a revision with another wall thickness
- **THEN** adoption is refused and no live geometry changed

### Requirement: Adoption keeps the live objects

A mesh the file gives `TEXCOORD_1` SHALL take the file's geometry shifted by its origin, keep its live object (material, `userData` with its callbacks, parent, registrations) and stand with its origin at the file's origin. A mesh without `TEXCOORD_1` (the site, glazing) SHALL keep its live geometry. Live mesh names SHALL NOT change; the file's names SHALL map to the live meshes. Adoption SHALL be undoable.

#### Scenario: Round trip keeps behaviour and positions
- **WHEN** the demo apartment is exported, given UV1 by a stand-in that splits every lit mesh into separate triangles, and adopted into a live scene of the same revision
- **THEN** every shell mesh keeps its name, parent, visibility, layers, material and `userData` with the same resolver answers, its triangles are the same in world space in the same order, its origin is the file's, the lit meshes have UV1, and the same rays hit the same meshes at the same distances

#### Scenario: Opening behaviour
- **WHEN** the dollhouse cuts away and restores walls on the adopted shell
- **THEN** every opening part is shown and placed exactly as on the live shell

### Requirement: Which meshes the bake lights

Exactly the meshes the bake tool gives `TEXCOORD_1` SHALL be bound: floors, ceilings, walls, skirtings, junction cores and opening frames and sills that are visible. Before any page is fetched, a sidecar whose bindings do not name exactly the file's meshes with `TEXCOORD_1` SHALL be refused. Glazing and the site SHALL stay live and unmarked, and a shell file that gives either of them `TEXCOORD_1` SHALL be refused before any page is fetched.

#### Scenario: A lit mesh left unbound
- **WHEN** a sidecar omits the binding of one mesh the file gives UV1
- **THEN** the bake is refused before any page, naming the rule

#### Scenario: A shell file that lights the site or glazing
- **WHEN** the shell file gives `TEXCOORD_1` to the site or to glazing, even with a binding for it
- **THEN** the bake is refused as a shell refusal before any page, naming the meshes that stay live

#### Scenario: Bound and live meshes
- **WHEN** the stand-in bake of the demo apartment is bound
- **THEN** every lit mesh's material is marked as a baked surface and the site and glazing keep their unmarked live materials

### Requirement: Applying a baked shell

`applyBakedShell` SHALL load the bake, check the revision, adopt the shell and bind the lightmap as one transaction: a binding refusal SHALL restore the adopted geometry and release the pages, and every refusal SHALL be answered as not applied with the reason, leaving the live shell as built. Dispose SHALL unbind, restore the live geometry and release the pages.

#### Scenario: Applied in the browser
- **WHEN** the demo apartment's stand-in bake is applied over the calibration page
- **THEN** the lightmap visibly changes the render, the adopted shell without its lightmap renders as the live shell, and after dispose every live geometry is back and the render is the live one

#### Scenario: Dispose while bound
- **WHEN** an applied bake is disposed without unbinding first
- **THEN** every shell mesh has its live geometry, material and transform and the render is the live one

#### Scenario: Binding refused after the pages loaded
- **WHEN** a binding's rect does not hold its mesh's UV1
- **THEN** the bake is not applied and every shell mesh has its live geometry, material and transform
