# glb-variant-materials Specification

## Purpose
Defines which materials the GLB body of a placed object renders with: a library variant drawn from its own GLB keeps the materials it ships, its declared finishes stay descriptive data, and a GLB served for a procedural archetype keeps slot dressing.

## Requirements

### Requirement: A builder-less GLB variant keeps its shipped materials

A variant that has a GLB (its own `model` or its archetype's) and whose archetype has no builder SHALL render every mesh of that GLB with the material the GLB ships, with the material the GLB loader produced for that mesh, not replaced and not modified, whatever finishes the archetype, the variant or the placement declare and whatever the project's `library.materials` contain.

#### Scenario: Project object with declared finishes and library materials
- **WHEN** a project scene whose library declares materials draws an object whose archetype `defaultFinishes` and variant `finishes` name those materials, and whose GLB ships a `metal` material (metalness 0.9, roughness 0.3) and a `top` material (roughness 0.28, clearcoat 0.35, clearcoat roughness 0.22)
- **THEN** after its GLB arrives, the `metal` mesh draws metalness 0.9 and roughness 0.3, and the `top` mesh draws roughness 0.28, clearcoat 0.35 and clearcoat roughness 0.22

#### Scenario: Placement finish override on such a variant
- **WHEN** a placement of that object carries a `finishes` override or a `material` shortcut naming a project material
- **THEN** every mesh still draws the material its GLB ships

#### Scenario: No finish declared at all
- **WHEN** a builder-less GLB variant declares no finish anywhere
- **THEN** it renders its shipped materials, as before

### Requirement: Declared finishes of such a variant are data only

For a builder-less GLB variant, the finishes its archetype and variant declare SHALL still be resolved into the asset's `finishes` and offered to the Replace picker's description (its `finishes`), and SHALL never be reported as unbound materials of its GLB.

#### Scenario: Picker description keeps the declared finishes
- **WHEN** the Replace picker describes a variant that declares finishes and has a GLB but no builder
- **THEN** its `finishes` list those finishes as before

#### Scenario: No unbound-material warning
- **WHEN** such a variant's GLB carries materials that no slot names
- **THEN** no `unbound-material` warning is reported for it

### Requirement: A GLB for a builder archetype keeps slot dressing

A GLB delivered for an archetype that has a procedural builder and declares finishes SHALL keep today's dressing: each glTF material bound to a slot by `materialSlots` or by its name wears that slot's finish.

#### Scenario: Shipped archetype with an injected model URL
- **WHEN** a host serves a GLB for a shipped archetype that has a builder and declares finishes
- **THEN** a material named after one of its slots wears that slot's finish, as before
