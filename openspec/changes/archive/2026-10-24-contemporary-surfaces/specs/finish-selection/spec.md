# Spec Delta

## MODIFIED Requirements

### Requirement: Current finish

The selection's current finish SHALL be the material UUID of the finish value in force on the picked surface, whether that value is a bare UUID or a finish object. When that UUID is a bundled alias and the project ships no material under it, the current finish SHALL be the alias target's id, including in the host selection description, and the alias SHALL not be offered as an option.

#### Scenario: Object finish in force
- **WHEN** the picked face wears `{ material: <m>, colour: '#c9d6df' }`
- **THEN** the selection's current finish is `<m>` and that option is marked current

#### Scenario: Alias in force
- **WHEN** the picked wall wears Cream stripes
- **THEN** Warm white is marked current and no Cream stripes option is listed

## ADDED Requirements

### Requirement: Scope actions keep a stored alias

When the picked surface wears a bundled alias, the selection's scope actions and the built-in panel's footer SHALL spread the stored alias reference until a swatch is picked; a picked swatch SHALL write the picked finish's id.

#### Scenario: Apply to all from an alias
- **WHEN** a wall wearing Cream stripes is picked and the footer applies to all walls without a swatch pick
- **THEN** every room's walls name Cream stripes

#### Scenario: Explicit pick
- **WHEN** Warm white is picked on that wall
- **THEN** the wall names Warm white
