## ADDED Requirements

### Requirement: Triangles no walk can see

The shell builders SHALL record, for every triangle of the shell geometry they build, whether a walk can see it, from what they know of the construction. The record SHALL NOT change the drawn geometry and SHALL NOT live in `userData`. Unseen triangles are about a walk, not the dollhouse: they are never dropped or hidden.

#### Scenario: Drawn geometry unchanged
- **WHEN** the demo apartment's shell is built
- **THEN** every shell mesh has a record with one entry per triangle and no `userData` key was added

### Requirement: Which triangles are unseen

Unseen SHALL be exactly: a floor slab's bottom cap and sides; a wall-face prism's back, its bottom on the floor, a cap at a chord boundary inside one quad, a cap fully covered by another quad of the same face, and a cap at the face's own end unless the wall continues collinearly into a wall of another thickness; a skirting board's back and bottom; a junction core's bottom cap. Every other triangle SHALL be seen.

#### Scenario: Demo apartment classes
- **WHEN** the demo apartment's shell is built
- **THEN** every floor has unseen bottom and side triangles and a seen top, every wall face has unseen back triangles, no ceiling, opening or site triangle is unseen, and no wall top is unseen

#### Scenario: Jog and continuation
- **WHEN** a straight wall continues into a collinear wall of the same thickness, and into one of another thickness
- **THEN** the touching end caps are unseen for the same thickness and seen for the other

## MODIFIED Requirements

### Requirement: Shell export

The player SHALL export the shell of a scene, built by its own builders, as a binary glTF with root nodes in build order: one node per shell mesh without unseen triangles, and for a shell mesh with unseen triangles its seen part followed immediately by its unseen part (a mesh whose triangles are all unseen gives the unseen part alone). Every node SHALL have an identity transform, with its mesh's world matrix applied to positions and normals, and exactly one primitive with `POSITION`, `NORMAL` and `TEXCOORD_0` and one material; both parts of a mesh SHALL carry the same material. The export SHALL be deterministic.

#### Scenario: World-space vertices
- **WHEN** the demo apartment is exported
- **THEN** every node has no transform, and the triangles of a mesh's parts, seen then unseen, are the live mesh's triangles in world space within 10 µm, partitioned by the builder's record

#### Scenario: UV1 is the bake tool's
- **WHEN** the demo apartment is exported
- **THEN** no mesh carries `TEXCOORD_1`

#### Scenario: Deterministic split
- **WHEN** the demo apartment is exported twice with the same minter
- **THEN** the files are byte-identical and the input digest equals `shellInputsHash` of the scene

### Requirement: Node contract

Each node's `extras.jeex` SHALL state the mesh's kind (`floor`, `ceiling`, `wall`, `skirting`, `joint`, `site`, `opening`) with the scene ids it belongs to, its run-time origin in world metres, `visible` as the full shell state draws it, `castShadow` and `receiveShadow`. An opening part SHALL carry its opening id, type, ordinal among the opening's exported parts and, when the builder names one, its part role. The unseen part of a mesh SHALL carry the same extras as its seen part plus `unseen: true`; `unseen` SHALL be allowed only on `floor`, `wall`, `skirting` and `joint`, and only as `true`.

#### Scenario: Ceilings are in the bake
- **WHEN** a ceiling the dollhouse hides at build time is exported
- **THEN** its extras say `visible: true`

#### Scenario: Unseen parts
- **WHEN** the demo apartment is exported
- **THEN** every node marked `unseen` follows a node of the same extras without the mark, or stands alone for a mesh with only unseen triangles, and the schema refuses `unseen` on a ceiling or as `false`

### Requirement: Shipped shell matches the live shell

The player SHALL accept a shipped shell file only when its nodes are, in order, the parts the live shell's meshes give by the builders' record (a seen part and an unseen part per mesh as the export writes them) with the same contract and finish value, with one finite value per vertex in every attribute and indices that make triangles of them. Vertex and index counts SHALL NOT be compared with the export, since the bake tool may split vertices. A mismatch SHALL refuse the whole file before anything changes.

#### Scenario: Another revision of the live shell
- **WHEN** the live scene was built from a revision with another wall thickness
- **THEN** adoption is refused and no live geometry changed

#### Scenario: A file without the split
- **WHEN** a shell file writes a mesh with unseen triangles as one node
- **THEN** adoption is refused and no live geometry changed

### Requirement: Adoption keeps the live objects

A mesh whose seen part the file gives `TEXCOORD_1` SHALL take that part's geometry shifted by its origin, keep its live object (material, `userData` with its callbacks, parent, registrations) and stand with its origin at the file's origin. Its unseen part, when the file has one, SHALL become a child mesh with the unseen geometry in the parent's frame, the parent's material at adoption, a shallow copy of the parent's `userData`, its shadow flags and its current layers; the parent SHALL answer raycasts for the child's triangles as its own (face indices after its own) and the child SHALL answer none itself. A mesh whose seen part has no `TEXCOORD_1` (the site, glazing, a hidden mesh) SHALL keep its live geometry and get no child. Live mesh names SHALL NOT change; the file's names SHALL map to the live meshes, an unseen part's name to its child. Adoption SHALL be undoable: undo removes the children, frees their geometry and restores the parent's geometry, transform and raycast.

#### Scenario: Round trip keeps behaviour and positions
- **WHEN** the demo apartment is exported, given UV1 by a stand-in that splits every lit mesh into separate triangles and skips unseen parts, and adopted into a live scene of the same revision
- **THEN** every shell mesh keeps its name, parent, visibility, layers, material and `userData` with the same resolver answers, its own triangles followed by its child's are its live triangles in world space partitioned by the record, its origin is the file's, the lit meshes have UV1, the children have none, and the same rays hit the same meshes at the same distances

#### Scenario: Opening behaviour
- **WHEN** the dollhouse cuts away and restores walls on the adopted shell
- **THEN** every opening part is shown and placed exactly as on the live shell, and every child is drawn exactly when its parent is

#### Scenario: Undo
- **WHEN** an adopted shell is restored
- **THEN** no child remains, every mesh has its live geometry, transform and raycast

### Requirement: Which meshes the bake lights

Exactly the meshes the bake tool gives `TEXCOORD_1` SHALL be bound: the seen parts of floors, ceilings, walls, skirtings, junction cores and opening frames and sills that are visible. Before any page is fetched, a sidecar whose bindings do not name exactly the file's meshes with `TEXCOORD_1` SHALL be refused. Glazing, the site and every unseen part SHALL stay live and unmarked, and a shell file that gives any of them `TEXCOORD_1` SHALL be refused before any page is fetched.

#### Scenario: A lit mesh left unbound
- **WHEN** a sidecar omits the binding of one mesh the file gives UV1
- **THEN** the bake is refused before any page, naming the rule

#### Scenario: A shell file that lights the site or glazing
- **WHEN** the shell file gives `TEXCOORD_1` to the site, to glazing or to an unseen part, even with a binding for it
- **THEN** the bake is refused as a shell refusal before any page, naming the meshes that stay live

#### Scenario: A binding naming an unseen part
- **WHEN** a sidecar binds an unseen part
- **THEN** the bake is refused before any page

#### Scenario: Bound and live meshes
- **WHEN** the stand-in bake of the demo apartment is bound
- **THEN** every lit mesh's material is marked as a baked surface, the site, glazing and every unseen child keep their unmarked live materials
