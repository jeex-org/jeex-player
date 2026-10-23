## ADDED Requirements

### Requirement: One bank per document answers floor questions

The viewer SHALL size and categorise every placement of a document from one facts source: the document's project library when it was loaded from a baked project, with the built-in bank behind it for anything the library does not declare. Walk obstacles, plan fixtures, the room graph used for travel, checkpoint obstacles, the plan modes, the layout linter, the free-space probe and the drag tool SHALL read that same source.

#### Scenario: Store ids collide

- **WHEN** the demo flat is loaded as a baked project whose archetype and variant ids are unknown to the built-in bank
- **THEN** every floor object at least 0.15 m tall is a walk obstacle (44 of its 59 placements), as with bank ids

#### Scenario: Store ids draw plan fixtures

- **WHEN** the same project is drawn in the 2D plan
- **THEN** the bath, both WCs, both vanities, the counter, the cooker, the fridge and the island are drawn as fixtures

#### Scenario: Undeclared placements fall through

- **WHEN** a project document holds a placement its library does not declare but the built-in bank does
- **THEN** that placement is sized and categorised by the built-in bank

### Requirement: Placements resolve the way the render path resolves them

A placement SHALL be looked up by `asset ?? type`, then by its `variant` id when that names nothing; its size SHALL be that of `placement.variant`, else the variant the id named, else the archetype's default variant.

#### Scenario: Default variant size

- **WHEN** a placement names a project archetype and no variant
- **THEN** it is sized by the archetype's default variant

#### Scenario: A known non-blocking object never takes a legacy box

- **WHEN** a placement names a known project rug and carries the type word `chair`
- **THEN** it is not an obstacle

### Requirement: Lint reads the same footprint as the walk

The layout linter's project catalogue SHALL give a placement the same floor footprint as the walk rule: none for a rug, the declared fraction for a plant, the explicit `collision` box when declared.

#### Scenario: Project rug in lint

- **WHEN** a project rug is linted
- **THEN** it has no floor box, so it raises no wall, overlap or door-zone finding

#### Scenario: Project plant in lint

- **WHEN** a project plant declaring `layout.footprint` is linted
- **THEN** its floor box is its plan size times that fraction

### Requirement: The walk rule

A placement SHALL be a walk obstacle by the first rule that applies: its explicit `collision` box; else the facts of the bank that knows it; else, only when no bank knows it, the legacy per-type table. The placement scale SHALL multiply the result.

#### Scenario: Explicit collision wins

- **WHEN** a placement declares `collision`
- **THEN** its obstacle is that box times the placement scale

### Requirement: Known floor objects collide by their floor share

A known placement SHALL be an obstacle when it is floor-anchored and its blocking height (`layout.blockingHeight` when declared, else the height in `dims`) is at least 0.15 m. Its plan size SHALL be `dims` times `layout.footprint` (a fraction) when declared, else `dims`. Any other known placement SHALL NOT be an obstacle.

#### Scenario: Fraction footprint

- **WHEN** a project object 1.0 m wide and 0.6 m deep declares `layout.footprint: 0.5`
- **THEN** its obstacle is 0.5 m by 0.3 m

#### Scenario: The height threshold is read before the placement scale

- **WHEN** a floor object 0.15 m tall is placed at scale 0.5
- **THEN** it is still an obstacle

#### Scenario: Blocking height wins over the overall height

- **WHEN** a floor object's overall height is 0.4 m and it declares `layout.blockingHeight: 0.02`
- **THEN** it is walked over

#### Scenario: A sofa from a store library is not reachable on foot

- **WHEN** the walk asks whether the centre of a store-id sofa can be walked to
- **THEN** the answer is no

### Requirement: Project objects' dims are overall bounding boxes

The format documentation SHALL state that a project object's `dims` is its overall bounding box, that `layout.footprint` (fraction) and `layout.blockingHeight` (metres) describe what of it stands on and blocks the floor, and that the built-in bank's dims are carcass dimensions.

#### Scenario: Documented

- **WHEN** a reader opens the README format section on `dims` and `layout`
- **THEN** the policy above is stated there
