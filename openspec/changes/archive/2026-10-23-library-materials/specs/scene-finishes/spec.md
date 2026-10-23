# Spec Delta

## Purpose

Defines how a scene document names the finish of each room surface, which finish may dress which surface, the scene schema version that carries it, and the `set_material` operation that writes it.

## ADDED Requirements

### Requirement: Scene schema 2.3

The viewer SHALL read scene documents of schema versions `2.2` and `2.3`, and refuse every other version. Version `2.3` is `2.2` plus the fields this capability adds. When another change has already introduced `2.3`, these fields join that same version.

#### Scenario: Both versions read
- **WHEN** a valid `2.2` document and a valid `2.3` document are loaded
- **THEN** both are accepted

#### Scenario: Future version refused
- **WHEN** a document declares `2.4`
- **THEN** it is refused with the unsupported-schema refusal naming `2.2` and `2.3`

### Requirement: New fields need 2.3

A document declaring `2.2` SHALL be refused when it uses a field or value new in `2.3`: a finish object, `rooms[].ceiling` or `rooms[].trim`. A `2.2` document without them SHALL validate and draw exactly as before.

#### Scenario: Ceiling in a 2.2 document
- **WHEN** a `2.2` document has `finishes.rooms[<room>].ceiling`
- **THEN** it is refused with an issue that names schema `2.3`

#### Scenario: Unchanged 2.2 document
- **WHEN** a `2.2` document that validated before this change is loaded
- **THEN** it validates and renders identically

### Requirement: Finish value

Every place a scene finish UUID stands SHALL accept a finish value: a bare finish UUID, or a strict object `{ material, colour?, rotation? }` where `material` is a UUID v7, `colour` is `#rrggbb` (sRGB) and `rotation` is a finite number of degrees, counter-clockwise from the automatic orientation. The places are `rooms[].floor`, `.walls`, `.ceiling`, `.trim`, `facade` and `faces[].finish`.

#### Scenario: Object finish on a face
- **WHEN** a `2.3` document has a face entry with `finish: { material: <uuid>, colour: '#d8cbb5', rotation: 90 }`
- **THEN** it is accepted

#### Scenario: Malformed colour
- **WHEN** a finish object has `colour: 'beige'`
- **THEN** the document is refused at that path

#### Scenario: Unknown key in a finish object
- **WHEN** a finish object carries `scale: 2`
- **THEN** the document is refused

#### Scenario: Non-finite rotation
- **WHEN** a finish object has a rotation that is not a finite number
- **THEN** the document is refused

### Requirement: Finish object carries a modifier

A finish object SHALL carry at least one of `colour` and `rotation`; an object with neither SHALL be refused with a message to use the bare UUID, so every finish has exactly one spelling.

#### Scenario: Modifier-free object refused
- **WHEN** a `2.3` document has `rooms[<room>].walls: { material: <m> }`
- **THEN** it is refused at that path with a message that says to use the bare UUID

#### Scenario: Bare, colour and rotation spellings
- **WHEN** a document uses `<m>`, `{ material: <m>, colour: '#c9d6df' }` and `{ material: <m>, rotation: 90 }`
- **THEN** all three are accepted

### Requirement: Finish shape checked at runtime

The runtime scene validation, which every document load runs, and the `set_material` apply path SHALL both check the finish value shape (strict object keys, `#rrggbb` colour, finite rotation, at least one modifier) at every finish location, independently of the published JSON schema.

#### Scenario: Load refuses a malformed finish
- **WHEN** a document with `facade: { material: <m>, colour: 'beige' }`, or a malformed finish at any other location, is loaded through the scene model
- **THEN** the load fails with a validation error at that path

#### Scenario: Apply refuses a malformed modifier
- **WHEN** an explicit `set_material` carries `rotation: Infinity` or `colour: '#abc'`
- **THEN** the operation is refused and the document is unchanged

### Requirement: Room ceiling and trim

`RoomFinishes` SHALL accept optional `ceiling` and `trim` finish values beside `floor` and `walls`. A room ceiling without a finish SHALL draw the bundled white plaster and a room's trim without a finish SHALL draw the default trim colour, both as today.

#### Scenario: Room with a ceiling finish
- **WHEN** a room has `ceiling` set to a project material that applies to `ceiling`
- **THEN** that room's ceiling draws that material and other rooms keep the white plaster

#### Scenario: Room with a trim finish
- **WHEN** a room has `trim` set
- **THEN** that room's baseboards draw it and other rooms keep the default trim

### Requirement: Surfaces a finish object may dress

A finish object SHALL name a project material of the `library` member whose `apply` contains the surface word of its place: `floor`, `wall` (room walls and room-owned faces), `ceiling`, `trim` or `facade` (the facade and facade faces). A `pbr` or `generator` project material and a bundled finish SHALL be referenced only by bare UUID.

#### Scenario: Wall material on a ceiling
- **WHEN** a finish object at `rooms[<room>].ceiling` names a material whose `apply` is `['wall']`
- **THEN** the document is refused with a wrong-surface issue that names the material and the surface

#### Scenario: Bundled finish in object form
- **WHEN** a finish object names a bundled finish that is not a project material
- **THEN** the document is refused with an issue that names the material

#### Scenario: Legacy project member in object form
- **WHEN** a finish object names a `pbr` or a `generator` project material
- **THEN** the document is refused with an issue saying modifiers need a library material

#### Scenario: Legacy project members by bare UUID
- **WHEN** a `2.3` document paints a floor with a `generator` material and a wall with a `pbr` material by bare UUID
- **THEN** it is accepted and both draw as before this change

### Requirement: Surfaces a bare finish UUID may dress

A bare finish UUID SHALL keep the rule of 2.2 extended to the new places: a bundled floor finish dresses floors; a bundled wall finish dresses walls, faces, the facade, ceilings and trim; a project material dresses every surface word in its `apply`, and one with `wall` also dresses the facade. A material whose `apply` holds several surface words dresses each of them.

#### Scenario: Project material for floor and wall
- **WHEN** a bare UUID of a project material with `apply: ['floor', 'wall']` stands at `rooms[<room>].walls`
- **THEN** the document is accepted

#### Scenario: Floor finish on walls
- **WHEN** a bundled floor finish stands at `rooms[<room>].walls`
- **THEN** the document is refused with a wrong-surface issue

#### Scenario: Legacy facade with a project wall material
- **WHEN** a `2.2` document paints its facade with a project material whose `apply` is `['wall']`
- **THEN** it is accepted as before

### Requirement: Finish resolution order

A wall face SHALL resolve its finish from its `faces` entry, then its owner (`rooms[].walls` or `facade`), then the default wall finish. A floor SHALL resolve from `rooms[].floor`, then `Room.floorMaterial`. A ceiling and trim SHALL resolve from their room entry, then their defaults.

#### Scenario: Face over room
- **WHEN** a room's walls and one of its faces both have finishes
- **THEN** that face draws its own finish and the other faces draw the room's

### Requirement: Finish values carried whole

The whole finish value, colour and rotation included, SHALL survive validation, topology remap, interior presets, scene export and repaint unchanged. The viewer SHALL never rewrite a document's finishes into another form.

#### Scenario: Split wall keeps the object
- **WHEN** a wall whose face wears `{ material, colour, rotation }` is split
- **THEN** both heir faces wear an equal object

#### Scenario: Export round trip
- **WHEN** a `2.3` document with finish objects is exported and loaded again
- **THEN** every finish value is deep-equal to the original

#### Scenario: Preset restores an object finish
- **WHEN** an interior preset captures and later restores a room whose walls wear a finish object
- **THEN** the room's walls wear a deep-equal object again

### Requirement: Explicit set_material form

`set_material` SHALL accept `{ op, surface, room?, face?, material, colour?, rotation? }` with `surface` one of `floor`, `wall`, `ceiling`, `trim` and `facade`. The material SHALL be a project or bundled finish that dresses that surface; `colour` and `rotation` are allowed only with a material of the `library` member.

#### Scenario: Floor of one room
- **WHEN** `{ surface: 'floor', room: <room>, material: <m> }` is applied
- **THEN** only that room's floor is set to `<m>`

#### Scenario: Surface not in apply
- **WHEN** `{ surface: 'ceiling', room: <room>, material: <m> }` names a project material whose `apply` lacks `ceiling`
- **THEN** the operation is refused and the document is unchanged

#### Scenario: Colour with a bundled finish
- **WHEN** the explicit form names a bundled finish and carries `colour`
- **THEN** the operation is refused

#### Scenario: Rotation with a generator material
- **WHEN** the explicit form names a `generator` project material and carries `rotation`
- **THEN** the operation is refused

### Requirement: Explicit form addressing

`face` SHALL be allowed only for `wall` (a room-owned face) and `facade` (a face with no room), and SHALL NOT be combined with `room`. Without `room` or `face`, `floor`, `ceiling`, `trim` and `wall` SHALL apply to every room and `facade` to the facade. `room` SHALL NOT be given for `facade`.

#### Scenario: Face on a floor
- **WHEN** `{ surface: 'floor', face: <face>, material }` is applied
- **THEN** it is refused

#### Scenario: Every room's ceiling
- **WHEN** `{ surface: 'ceiling', material }` is applied
- **THEN** every room's ceiling is set

#### Scenario: Room walls clear face overrides
- **WHEN** `{ surface: 'wall', room: <room>, material }` is applied to a room with painted faces
- **THEN** the room's walls are set and its face overrides are removed, as the legacy room target does

#### Scenario: Facade face
- **WHEN** `{ surface: 'facade', face: { wallId, side }, material }` is applied
- **THEN** only that facade face is set

### Requirement: Value written by the explicit form

The explicit form SHALL write the bare material UUID when it carries neither `colour` nor `rotation`, and the finish object `{ material, colour?, rotation? }` otherwise. Writing a finish object, a ceiling or a trim into a `2.2` document SHALL be refused, because operations never change a document's version.

#### Scenario: Plain material written bare
- **WHEN** `{ surface: 'wall', room, material: <m> }` is applied
- **THEN** `rooms[<room>].walls` is the string `<m>`

#### Scenario: Tinted paint written as object
- **WHEN** `{ surface: 'wall', room, material: <m>, colour: '#c9d6df' }` is applied to a `2.3` document
- **THEN** `rooms[<room>].walls` is `{ material: <m>, colour: '#c9d6df' }`

#### Scenario: Object into a 2.2 document
- **WHEN** the same operation is applied to a `2.2` document
- **THEN** it is refused with an error that names schema `2.3`

### Requirement: Presets read the operation form

Interior preset coverage and the reset a preset appends SHALL read the destination surface from `surface` for an explicit operation; only a legacy operation's surface SHALL be inferred from the material. A preset SHALL restore a captured finish in its exact spelling.

#### Scenario: Explicit wall paint with a floor-and-wall material
- **WHEN** a preset holds `{ surface: 'wall', room, material: <m> }` where `<m>` applies to floor and wall
- **THEN** the preset counts the room's walls as repainted, not its floor, and its reset does not overwrite that paint

#### Scenario: Explicit face and all-room operations
- **WHEN** a preset holds an explicit face operation and an explicit every-room wall operation
- **THEN** coverage names that face and every room's walls respectively

#### Scenario: Exact spelling restored
- **WHEN** a preset captures a bare `<m>` and `{ material: <m>, rotation: 90 }` and restores them
- **THEN** the restored values are the bare string and the deep-equal object

### Requirement: Legacy set_material form

The `{ op, target, material, scope? }` form SHALL keep its behaviour: aliases `floors`, `walls`, `facade`, a room UUID or a face key. Only this form infers the surface; for a room target, a material that dresses floors paints the floor, else one that dresses walls paints the walls.

#### Scenario: Legacy room target
- **WHEN** a legacy `{ target: <room>, material: <bundled floor finish> }` is applied
- **THEN** the room's floor is set, as before this change

#### Scenario: Both forms at once
- **WHEN** an operation carries both `surface` and `target`
- **THEN** it is refused

### Requirement: Operation results name the touched surface

Every `set_material` result SHALL name what it touched, including the new ceiling and trim surfaces, so a host and the repaint can follow it.

#### Scenario: Ceiling touched
- **WHEN** a room's ceiling is set
- **THEN** the result's touched list names that room's ceiling and only the ceiling is repainted

#### Scenario: Every room's ceiling with a loggia
- **WHEN** every room's ceiling is set in a plan whose rooms include a loggia, which has no ceiling
- **THEN** each room with a ceiling repaints, the loggia stays as it is, and the viewer reports no drift and does not rebuild
