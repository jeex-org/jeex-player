## ADDED Requirements

### Requirement: A light bake is applied once the mounted document has settled

The viewer SHALL apply a light bake named for a mounted document only after the document's first model pass has ended and every library map of its shell has attached or given up, and SHALL apply it to the live shell objects of that mount.

#### Scenario: Maps still loading

- **WHEN** a document is mounted with a bake named and a library map of its shell is still loading
- **THEN** no bake file is fetched and the state is `waiting` until that map has attached

#### Scenario: Applied

- **WHEN** the document has settled and the bake fits the live shell
- **THEN** the bound shell meshes are marked as baked surfaces, the shell keeps its mesh objects, and the state is `applied` with the bake id and the number of bound meshes

### Requirement: The live shell is read again after the bake's files have loaded

The apartment loader SHALL compare the live shell after the files have loaded with the shell it checked before fetching them, and SHALL refuse the bake when a mesh or its contract changed, or when its caller aborted the attempt, releasing every loaded page and changing nothing.

#### Scenario: Shell changed while loading

- **WHEN** a shell mesh leaves the live shell while the atlas pages are loading
- **THEN** the bake is refused with "the live shell changed while the light bake was loading" and no live mesh takes the shipped geometry

#### Scenario: Aborted while loading

- **WHEN** the caller aborts the attempt while the files are loading
- **THEN** the bake is refused and the live shell is exactly as before

### Requirement: The bake is dropped before the shell it lit changes

The viewer SHALL dispose the bake (unbind and restore the shell geometry) before a plan rebuild, before a mounted document is released or replaced, and on dispose; and SHALL drop it before any revision of the shell, a finish, an opening, the site or a lamp of the bake is applied to the geometry (while the bake's lamps are not known yet, any furniture revision drops it). Camera, route and other furniture revisions SHALL keep it. A dropped bake SHALL NOT be applied again for that document.

#### Scenario: Repaint

- **WHEN** a floor finish is changed while a bake is applied
- **THEN** the bake is dropped first, the new finish is drawn on the live material, and the state is `dropped`

#### Scenario: Dispose

- **WHEN** the viewer is disposed with a bake applied
- **THEN** no shell mesh keeps the shipped geometry or a baked material

#### Scenario: Remount after a lost context

- **WHEN** a WebGL context is lost and restored with a bake applied to a document nobody edited
- **THEN** the old shell's bake is disposed before the shell is rebuilt, and the rebuilt shell is baked exactly once

#### Scenario: Remount after an edit

- **WHEN** a revision dropped the bake and the context is then lost and restored
- **THEN** the bake is not applied to that document again

### Requirement: A refused bake keeps live lighting and says why once

The viewer SHALL report a refused bake as one `warn` log entry with the code `light-bake-refused`, the refusal's message and its reason, SHALL report an unexpected failure as one `error` entry `light-bake-failed`, and SHALL keep the live shell and its live lighting in both cases.

#### Scenario: Another revision

- **WHEN** the named bake was made for another revision of the shell
- **THEN** exactly one `light-bake-refused` entry is logged, the state is `refused` with reason `shell`, and no shell mesh is baked

### Requirement: An internal page switch names the light bake

The viewer SHALL read `globalThis.__JEEX_DEBUG_LIGHT_BAKE__ = { sidecar, shell }` at every mount, both non-empty strings resolved as URLs against the page; an absent or malformed value SHALL be off. It SHALL NOT be a viewer option, a query key or a package export.

#### Scenario: No switch

- **WHEN** a page does not set the global
- **THEN** the viewer fetches no bake and the state is `off`

### Requirement: An internal page switch names the opening camera view

The viewer SHALL read `globalThis.__JEEX_DEBUG_CAMERA__ = { mode: 'walk' | 'orbit', position: [x, y, z], target: [x, y, z] }` once at the start view and, when valid, open in that mode at that pose instead of the authored start view: `walk` stands exactly at the pose, `orbit` places the orbit at the pose within its limits. An absent or malformed value SHALL change nothing.

#### Scenario: Two pages, one view

- **WHEN** two pages set the same camera and one of them also names a bake
- **THEN** both open in the same mode with the camera at the same position and target

#### Scenario: Malformed

- **WHEN** the camera global has a two-component position
- **THEN** the viewer opens in its authored start view
