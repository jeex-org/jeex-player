## REMOVED Requirements

### Requirement: Mode parity of baked light

**Reason**: The lightmap was scaled by the walk sun factor in walk; it is indirect light and now carries the gain of its mode instead.

**Migration**: replaced by «Baked light per mode» below.

## ADDED Requirements

### Requirement: Baked light per mode

The lightmap's contribution on a baked surface SHALL be scaled by the baked-interior gain of the mode (`LIGHTING_STANDARD.baked.exposure`): the editing gain in the editing modes, the walk gain in walk and tour and in their grid and probe captures. It SHALL NOT be scaled by the walk sun factor: it is indirect light, like the room grid, shown at the walk exposure in walk and tour. The gain SHALL touch the lightmap alone, never live objects, the direct sun or reflections.

#### Scenario: Walk does not divide the lightmap by the walk exposure
- **WHEN** a baked floor inside a room is read in walk and in an editing mode with the same camera, before the post chain
- **THEN** its lightmap contribution in walk is the editing contribution times the walk gain over the editing gain, within the tolerance, and not times the walk sun factor

#### Scenario: The gain follows the mode
- **WHEN** a scene leaves the editing modes for walk and comes back
- **THEN** its baked surfaces carry the walk gain while in walk and the editing gain again once back, with no new program

#### Scenario: Capture sees what walk shows
- **WHEN** a room probe or a grid probe is captured for walk
- **THEN** the baked surface in the capture carries its lightmap times the walk gain

#### Scenario: Live objects keep their light
- **WHEN** a surface that is not baked is drawn beside a baked one, in an editing mode and in walk
- **THEN** its reading does not depend on the baked-interior gains
