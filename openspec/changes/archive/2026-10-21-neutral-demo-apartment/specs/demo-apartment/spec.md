# Spec Delta

## Purpose

Defines the demo apartment the player ships for its demo pages and publishes on its site: what it must contain to show the player's features, the quality guarantees it meets, and that it is invented content.

## ADDED Requirements

### Requirement: Invented, market-neutral content

The demo apartment SHALL be an invented, market-neutral plan. Its scene name, room names, descriptions and source comments SHALL be English, SHALL present the plan as invented, and SHALL NOT name a real country, city, district, company or brand.

#### Scenario: Scene name and description
- **WHEN** the demo scene document is read
- **THEN** its name is `Two-bedroom demo apartment`
- **AND** the demo scene source describes the plan as invented for the player

#### Scenario: Published copy
- **WHEN** the site build serialises the demo scene to `demo/demo-apartment.json`
- **THEN** the published document is the invented apartment and validates against schema 2.2

#### Scenario: Published pages
- **WHEN** the site's pages and agent notes (`index.html`, `integration.html`, `install.md`, `llms.txt`) and its poster and social image are read
- **THEN** their description of the demo apartment is accurate and neutral, their snippets load `demo/demo-apartment.json`, and the images are renders of the invented apartment

### Requirement: Own entity identities

Every entity the demo apartment defines (the scene, its nodes, walls, openings, rooms, furniture placements and interior presets) SHALL carry a fixed UUID v7 literal held as a named constant; the player SHALL mint none of them. Catalogue, variant and finish references SHALL be the bundled catalogue's own ids.

#### Scenario: Every id is a UUID v7
- **WHEN** the demo scene is validated
- **THEN** every entity id is a lowercase UUID v7 and every asset, variant and finish reference resolves in the bundled catalogue

#### Scenario: New identity
- **WHEN** a host compares the new demo's ids with the previously shipped demo
- **THEN** no entity id is shared between the two

### Requirement: Compatibility for hosts and copies

Replacing the demo SHALL change no schema, public API or catalogue id. A copy of the previous demo JSON that a project keeps SHALL stay valid and load unchanged; a host that adopts the new demo SHALL read entity ids from the new document, and the player SHALL NOT remap old demo ids to new ones.

#### Scenario: An older copy still loads
- **WHEN** a host loads a previously vendored copy of the old demo document
- **THEN** it validates and renders as before, because schema 2.2 and the catalogue ids are unchanged

#### Scenario: Old ids are not redirected
- **WHEN** a host sends a command that names an entity id of the old demo to a viewer showing the new one
- **THEN** the command is treated like any unknown id, with no automatic mapping to a new entity

### Requirement: Showcase coverage

The demo apartment SHALL exercise the scene features the player supports: rooms including two bedrooms with beds, a kitchen island, a loggia reached from two rooms, a curved wall with a window along the arc, facade, bearing and partition walls, an entrance door flagged in the data, ten doors with authored hinge and swing, windows, furniture in every room, and four interior presets.

#### Scenario: Programme
- **WHEN** the plan is solved
- **THEN** it yields nine rooms: kitchen, bathroom, WC, guest bedroom, entrance hall, living and dining room, bedroom, study and one loggia marked `kind: 'loggia'`

#### Scenario: Curved wall
- **WHEN** the living room's floor loop is read
- **THEN** it contains exactly one curved face, the bay, with a window centred on the arc

#### Scenario: Doors and windows
- **WHEN** the openings are read
- **THEN** there are exactly ten doors, each with `hinge` and `swing`, exactly one of them flagged `entrance`, and every room has a door and every room except the hall and the WC has a window

#### Scenario: Loggia from two rooms
- **WHEN** the doors of the loggia are read
- **THEN** one opens to the living and dining room and one to the bedroom

#### Scenario: Furniture showcase
- **WHEN** the placements are read
- **THEN** the kitchen holds an island, both bedrooms hold a double bed with two nightstands, and every room holds at least three placements

#### Scenario: Interior presets
- **WHEN** the scene's interiors are read
- **THEN** there are four, in panel order, and the first is named `Oak and sand`

### Requirement: Layout guarantees

The demo apartment's furniture SHALL pass the layout linter with no error and no warning, both as shipped and after each of its interior presets is applied, and every case good SHALL face into its room.

#### Scenario: Linter as shipped
- **WHEN** the layout linter runs on the shipped scene
- **THEN** it reports 0 errors and 0 warnings

#### Scenario: Linter under presets
- **WHEN** any of the four interior presets is applied to a fresh model of the scene
- **THEN** the apply succeeds as one revision and the linter still reports 0 errors and 0 warnings

#### Scenario: A preset dresses, it never re-lays
- **WHEN** any interior preset is applied
- **THEN** every placement keeps its position, rotation and scale, and its resolved plan footprint and height are those of the shipped variant

#### Scenario: First preset is the standard
- **WHEN** another preset is applied and then the first one
- **THEN** every finish and variant is back to what the scene ships

### Requirement: Navigation and tour

The demo apartment SHALL give every room a room camera and a navigation point inside it, a walk spawn on free floor, and an autotour whose every waypoint is a legal standing place, whose every leg crosses walls only at doors and clears the furniture, and whose rendered, corner-rounded run keeps clear of the furniture.

#### Scenario: Cameras and points
- **WHEN** room cameras and navigation points are read
- **THEN** each of the nine rooms has a camera at eye height inside it and at least one navigation point inside it, and no camera, navigation point or the walk spawn stands inside a furniture footprint

#### Scenario: Tour legs
- **WHEN** consecutive autotour waypoints are checked
- **THEN** each leg is traversable through the plan and not blocked by furniture, and the route visits every room except the WC and enters the bay

#### Scenario: Rendered run
- **WHEN** the tour player plays the whole autotour with its corner rounding
- **THEN** every sampled pose keeps the clearance to furniture footprints the tour player's tests hold the demo to, stays at eye level indoors and passes through doorways

#### Scenario: Gaze and pace
- **WHEN** the autotour's gaze keys and speed zones are read
- **THEN** every key names an existing waypoint, and the kitchen zone is slower than the living-room zone
