## ADDED Requirements

### Requirement: A bank object is as tall as its dims

Every variant of the built-in dining chair, media unit and houseplants SHALL be built exactly as tall as the height its dims declare (vertex-exact bounds, within 5 mm) and stand on the floor. The chair and the plants SHALL also be no wider or deeper than their dims; the media unit, like every case good of the bank, may exceed its carcass depth by its fronts and handles.

#### Scenario: Dining chair

- **WHEN** any dining chair variant is built
- **THEN** it is no taller than its 0.86 m dims and both rear posts reach the floor

#### Scenario: Media unit

- **WHEN** any media unit variant is built
- **THEN** its height equals its dims height: 1.366 m, and 1.512 m for the 2.2 m variant

#### Scenario: Houseplant

- **WHEN** any houseplant variant is built
- **THEN** the top of its crown is at its dims height

### Requirement: A fixture with a tap declares its carcass top

The kitchen island, the vanity with basin and the freestanding bath SHALL declare `layout.blockingHeight` as the top of the carcass their tap stands on, measured on the catalogue-size variant; a size variant's carcass top SHALL lie within 25 mm of it (the compact bath's rim is 0.56 m against 0.58 m, a conservative archetype value). They SHALL declare no `layout.footprint`, because no part of the tap lies outside the plan of the body.

#### Scenario: Declared heights

- **WHEN** the bank's facts for the island, the vanity and the bath are read
- **THEN** their blocking heights are 0.94 m (worktop), 0.88 m (stone top) and 0.58 m (rim), and the tap is what makes each overall body taller than that

#### Scenario: Exported overall box

- **WHEN** an exporter writes the vanity's overall bounding box (1.137 m tall, tap included) as its project dims and carries its layout facts over
- **THEN** the facts it carries still name 0.88 m as its blocking height, which the floor-footprints walk rule reads before the overall height

### Requirement: The media unit reads as a TV

The media unit's screen SHALL use a near-black, glossy finish with no emission of its own; its bezel SHALL be that same glass and its stand SHALL take the variant's `leg` finish, never the `metal` slot the handles wear (brass on the walnut and oak units).

#### Scenario: Screen and casing

- **WHEN** any media unit variant is built
- **THEN** its screen finish is near-black with roughness at most 0.1 and no glow, its bezel is that same glass, and its stand takes the variant's `leg` finish

### Requirement: The vanity's vessel basin is open

The vanity's vessel basin SHALL be an open shell standing on the stone top, which is its floor.

#### Scenario: Open basin

- **WHEN** any vanity variant is built
- **THEN** its basin is an open-ended shell, not a capped solid
