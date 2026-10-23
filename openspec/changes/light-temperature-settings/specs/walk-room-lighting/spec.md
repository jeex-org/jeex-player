## ADDED Requirements

### Requirement: Direct sunlight inside rooms in walk and tour

In walk and tour, direct sunlight reaching surfaces inside a room box SHALL be scaled by the walk sun factor (1/3.5 of the editing value at the walk exposure 3.5), so sunlit floors keep their texture; surfaces outside rooms, the editing modes and captures of other states SHALL keep the unscaled sun. The windowless room SHALL keep reading at most 0.35 of the window room on a grey card, and the window room 0.25–0.45 of its editing value.

#### Scenario: Sunlit floor not clipped
- **WHEN** the demo apartment's sunlit living-room floor is viewed in walk at the evening preset (a 64 × 64 px region)
- **THEN** fewer than 1 % of its pixels are at the display maximum and the standard deviation of its luminance is within 20 % of the editing view's

#### Scenario: Lamps unaffected by the sun factor
- **WHEN** a lamp-lit card inside a room is compared with the sun factor on and off
- **THEN** its lamp contribution is unchanged

#### Scenario: Façades keep their sun
- **WHEN** a façade is viewed in walk
- **THEN** it reads as in the editing modes within 5 %
