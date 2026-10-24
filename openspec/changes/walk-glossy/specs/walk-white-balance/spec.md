# Spec Delta

## Purpose

The camera white balance of the walk and tour picture: a fixed, partial adaptation of the final image towards the display white, so a room under warm lamps mixed with daylight reads warm white instead of tinted, without touching the editing modes or the light the scene is lit with.

## ADDED Requirements

### Requirement: White balance of the walk and tour picture

The picture the walk post-processing chain draws SHALL be white-balanced by one fixed linear 3×3 matrix, applied once to the scene's linear colour inside the display transform, before tone mapping, exposure and display encoding. The matrix SHALL be a partial chromatic adaptation that keeps some of the light's warmth, and SHALL preserve luminance for every input colour.

#### Scenario: Applied once, before tone mapping
- **WHEN** a walk display draw renders a flat patch of known linear colour through the chain
- **THEN** its displayed colour equals the display transform of the matrix times that colour, within 1/255 per channel

#### Scenario: Luminance kept
- **WHEN** the chain renders the same view with the white balance and with it at identity
- **THEN** a neutral patch's linear luminance before tone mapping, and the whole view's mean, are the same within 0.5 %

#### Scenario: No extra pass
- **WHEN** the chain is built in walk
- **THEN** it has the same passes and render targets as without the white balance

### Requirement: Where the white balance applies

The white balance SHALL apply to every picture the walk and tour chain draws: display draws, and stills and video frames captured through the chain. It SHALL NOT apply to room grid captures, reflection probe captures, lightmaps, panoramas (which keep their direct path) or any editing mode.

#### Scenario: Editing modes unchanged
- **WHEN** an orbit frame is taken before and after a walk session
- **THEN** the two frames are pixel-identical

#### Scenario: Probes see the unbalanced scene
- **WHEN** a room's reflection probe is captured with the white balance set and with it at identity
- **THEN** the two captured probes are identical

#### Scenario: Still matches the screen
- **WHEN** a still of the live state is captured in walk
- **THEN** it carries the same white balance as the screen: a neutral patch's colour ratios in the still match the screen's within 2 %

### Requirement: Calibrated warm white

The matrix SHALL be derived from a recorded measurement: the mean linear colour of the neutral surfaces (the ceiling and the white walls) at the demo apartment's walk start, in walk with the room lighting live and the default sun and lamps, and a recorded degree of adaptation. After it, the ceiling there SHALL read warm white: red over blue between 1.3 and 1.6, red ≥ green ≥ blue.

#### Scenario: Ceiling at the walk start
- **WHEN** the demo apartment's living-room ceiling is metered at the walk start, before tone mapping, with the room lighting live
- **THEN** without the white balance its linear red over blue matches the recorded measurement within 5 %, and with it the value lies between 1.3 and 1.6 with red ≥ green ≥ blue

#### Scenario: Reproducible matrix
- **WHEN** the matrix is computed from the recorded source colour and degree of adaptation
- **THEN** it equals the matrix the chain uses

#### Scenario: Coloured furniture and window keep their hue
- **WHEN** a saturated furniture finish and the window are metered at the walk start with and without the white balance
- **THEN** each keeps its dominant channel, and the window's sky does not turn warmer than without it
