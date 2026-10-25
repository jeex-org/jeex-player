## ADDED Requirements

### Requirement: Wall removal merges the rooms it joins

When a batch contains `remove_wall` and a face of the final plan holds the anchors of several attached rooms that were in the committed document with the same anchors, the commit SHALL merge them into one room instead of refusing with `MULTI_ANCHOR`. Detached rooms SHALL take no part.

#### Scenario: Wall between two rooms removed
- **WHEN** the only wall between the kitchen and the living room is removed
- **THEN** the batch commits with one room covering both

#### Scenario: Three rooms in one batch
- **WHEN** one batch removes the two walls separating three rooms
- **THEN** the three become one room in one revision

### Requirement: A merge never hides a genuine anchor error

A face that holds a second anchor because the batch added a room or moved a room's anchor SHALL still be refused with `MULTI_ANCHOR`. A batch without `remove_wall` SHALL never merge rooms. A final plan with a dangling node or a disconnected graph SHALL still be refused, leaving the document and revision unchanged.

#### Scenario: Added room in an occupied face
- **WHEN** a batch adds a room whose anchor lies in an existing room's face
- **THEN** the batch is refused with `MULTI_ANCHOR`

#### Scenario: Moved anchor with a removal
- **WHEN** a batch removes a wall and also moves a room's anchor into the joined face
- **THEN** the batch is refused with `MULTI_ANCHOR`

#### Scenario: Removal and merge in one batch
- **WHEN** a batch removes a partition and merges the two collinear walls at its junction, both sides painted
- **THEN** it commits, the rooms merge, and each side of the merged wall keeps one paint

### Requirement: The largest room survives

In each merged group the room with the largest floor area in the committed plan SHALL survive, a tie going to the lexicographically smallest id. The survivor SHALL keep its id, anchor, name, kind, purpose, accent, floor material, `finishes.rooms` entry and camera.

#### Scenario: Living room absorbs the kitchen
- **WHEN** a 20 m² living room and an 8 m² kitchen merge
- **THEN** the living room's id, name and floor survive and the kitchen is gone

#### Scenario: Room and loggia
- **WHEN** a room merges with a smaller loggia
- **THEN** the merged room keeps the kind `room`

### Requirement: What the absorbed rooms leave behind

Objects bound to an absorbed room SHALL be rebound to the survivor without moving. Wall faces painted for an absorbed room SHALL be re-keyed to the survivor. Its `finishes.rooms` entry and camera SHALL be dropped, as SHALL preset instructions naming it in any field, and preset instructions naming the removed wall, an emptied preset going with them.

#### Scenario: Objects and paint follow
- **WHEN** the kitchen with a fridge and a painted wall face merges into the living room
- **THEN** the fridge stays where it stood bound to the living room, and the face keeps its paint under the living room

### Requirement: The merge is reported

A successful batch that merged rooms SHALL report `roomMerges`, one `{ from, to, summary }` per absorbed room sorted by `from`, the summary naming both rooms by their names before the merge. `touched` SHALL include the shell, rebound objects, dropped cameras, the absorbed rooms' floor, walls, ceiling and trim, and old and new keys of re-keyed faces.

#### Scenario: Journal line
- **WHEN** the kitchen merges into the living room
- **THEN** the result carries `{ from: kitchen, to: living, summary: "Kitchen merged into Living room" }`
