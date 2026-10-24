# walk-white-balance Specification

## Purpose
The camera white balance of the walk and tour picture: a fixed, partial adaptation of the final image towards the display white, so a room under warm lamps mixed with daylight reads warm white instead of tinted, without touching the editing modes or the light the scene is lit with.

## Requirements

### Requirement: White balance of the walk and tour picture

The picture the walk post-processing chain draws SHALL be white-balanced by one fixed linear 3×3 matrix, applied once to the scene's linear colour inside the display transform, before tone mapping, exposure and display encoding. The matrix SHALL be a partial chromatic adaptation that keeps some of the light's warmth and SHALL preserve luminance exactly for every input colour; negative results SHALL then be clamped to zero.

#### Scenario: Applied once, before tone mapping
- **WHEN** a walk display draw renders a flat patch of known linear colour through the chain
- **THEN** its displayed colour equals the display transform of the matrix times that colour, clamped at zero, within 1/255 per channel

#### Scenario: Matrix keeps luminance before clipping
- **WHEN** the matrix is applied to any linear colour, before the clamp
- **THEN** the luminance of the result equals the luminance of the input within floating-point precision

#### Scenario: Luminance kept on screen
- **WHEN** the chain renders the same view with the white balance and with it at identity
- **THEN** a neutral patch's linear luminance before tone mapping, and the whole view's mean, are the same within 0.5 %

#### Scenario: No extra pass
- **WHEN** the chain is built in walk
- **THEN** it has the same passes and render targets as without the white balance

### Requirement: Where the white balance applies

The white balance SHALL apply to every picture the walk and tour chain draws (display draws, stills and video frames captured through it) and to the display pass of a panorama captured while the chain is available. It SHALL NOT apply to room grid captures, reflection probe captures, a panorama's cube faces, lightmaps or any editing mode.

#### Scenario: Editing modes unchanged
- **WHEN** an orbit frame is taken before and after a walk session
- **THEN** the two frames are pixel-identical

#### Scenario: Probes see the unbalanced scene
- **WHEN** a room's reflection probe is captured with the white balance set and with it at identity
- **THEN** the two captured probes are identical

#### Scenario: Panorama matches a still
- **WHEN** a panorama and a still of the same room are captured in walk with the room lighting live
- **THEN** a neutral patch seen in both has the same colour ratios within 2 %, and the panorama's cube faces are rendered without the white balance

#### Scenario: Still matches the screen
- **WHEN** a still of the live state is captured in walk
- **THEN** it carries the same white balance as the screen: a neutral patch's colour ratios in the still match the screen's within 2 %

### Requirement: Calibrated warm white

The matrix SHALL be derived from a recorded measurement in the linear domain before tone mapping (the metering domain and exposure recorded with it): the mean linear colour of the neutral surfaces (the ceiling and the white walls) at the demo apartment's walk start, in walk with the room lighting live and the default sun and lamps, and a recorded degree of adaptation. After it, the ceiling there SHALL have red over blue between 1.3 and 1.6 and red ≥ green ≥ blue.

#### Scenario: Ceiling at the walk start
- **WHEN** the demo apartment's living-room ceiling is metered at the walk start, before tone mapping, with the room lighting live
- **THEN** without the white balance its linear red over blue matches the recorded measurement within 5 %, and with it the value lies between 1.3 and 1.6 with red ≥ green ≥ blue

#### Scenario: Reproducible matrix
- **WHEN** the matrix is computed from the recorded source colour and degree of adaptation
- **THEN** it equals the matrix the chain uses

#### Scenario: Coloured furniture and window keep their hue
- **WHEN** a saturated furniture finish and the window are metered at the walk start with and without the white balance
- **THEN** each keeps its dominant channel, and the window's sky does not turn warmer than without it
