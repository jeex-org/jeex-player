## ADDED Requirements

### Requirement: Direct sunlight inside rooms in walk and tour

In walk and tour, direct sunlight reaching surfaces inside a room box SHALL be scaled by the walk sun factor (1/3.5 of the editing value at the walk exposure 3.5), so sunlit floors keep their texture; surfaces outside rooms, the editing modes and captures of other states SHALL keep the unscaled sun. The windowless-room and walk-to-editing ratios of this capability SHALL still hold.

#### Scenario: Sunlit floor not clipped
- **WHEN** a sunlit floor patch is viewed in walk
- **THEN** fewer than 1 % of its pixels are at the display maximum and its texture contrast is within 20 % of the editing view's

#### Scenario: Façades keep their sun
- **WHEN** a façade is viewed in walk
- **THEN** it reads as in the editing modes within 5 %
