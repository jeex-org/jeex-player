# Spec Delta

## Purpose

Defines which finishes the viewer's built-in swatches and the selection descriptions it hands to a host offer for a picked room surface, so a project's library materials can be chosen where they apply.

## ADDED Requirements

### Requirement: Project materials offered by surface

For a picked floor or wall, the swatches and the host selection description SHALL list the project library materials whose `apply` contains the picked surface word (`floor`, `wall`, or `facade` for a facade face) first, in manifest order, followed by the bundled finishes of that surface as today.

#### Scenario: Floor picked in a project
- **WHEN** a floor is picked in a project whose library has a floor scan, a wall paint and a ceiling paint
- **THEN** the floor options start with the floor scan and contain neither paint

#### Scenario: Facade face picked
- **WHEN** a facade face is picked
- **THEN** the options list the project materials whose `apply` contains `facade`, then the bundled wall finishes

#### Scenario: Bare scene
- **WHEN** a scene without a project is picked
- **THEN** the options are the bundled finishes, unchanged

### Requirement: Option operations use the explicit form

Every option for a project library material SHALL carry a `set_material` operation in the explicit form, naming the picked surface and its room or face, and its scope operations (this face only, the whole room, every room) SHALL use the same form.

#### Scenario: Pick a scan for one room
- **WHEN** the floor option of a scan is chosen for one room
- **THEN** the operation applied is `{ op: 'set_material', surface: 'floor', room: <room>, material: <scan> }`

### Requirement: Scope actions follow the destination surface

An option's narrow and broad actions SHALL each be offered only when the material's `apply` contains the surface that action paints; an action whose surface is not supported SHALL be omitted, never converted.

#### Scenario: Facade-only material
- **WHEN** a facade face is picked and a material with `apply: ['facade']` is shown
- **THEN** it offers the facade actions only and no footer action that paints every room's walls

#### Scenario: Facade and wall material
- **WHEN** the same face is picked and a material with `apply: ['facade', 'wall']` is shown
- **THEN** it offers the facade actions and the every-room walls action

### Requirement: Option appearance

A library material option SHALL show its `preview` when present and otherwise a flat chip; its flat colour SHALL be `averageColour`, or the first suggested colour for a tintable material.

#### Scenario: Tintable paint chip
- **WHEN** a tintable paint without a preview is listed
- **THEN** its chip shows its first suggested colour

### Requirement: Current finish

The selection's current finish SHALL be the material UUID of the finish value in force on the picked surface, whether that value is a bare UUID or a finish object.

#### Scenario: Object finish in force
- **WHEN** the picked face wears `{ material: <m>, colour: '#c9d6df' }`
- **THEN** the selection's current finish is `<m>` and that option is marked current
