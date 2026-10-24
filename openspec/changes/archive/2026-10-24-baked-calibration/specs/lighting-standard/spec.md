## MODIFIED Requirements

### Requirement: Published description and version

The entry SHALL publish a read-only description of the standard (engine revision, display transform, calibration target, environment parameters, rig values, sun presets, shadow tuning values and the baked-interior gains) and an appearance version number, raised with every intentional change of the look. The entry SHALL export the lighting error type and its codes.

#### Scenario: Description is read-only
- **WHEN** a consumer tries to change a value of the published description, at any depth
- **THEN** the value does not change

#### Scenario: Version
- **WHEN** a consumer reads the appearance version
- **THEN** it stays 1: the additions are data and functions that change no existing rig value

#### Scenario: Baked-interior gains
- **WHEN** a consumer reads `LIGHTING_STANDARD.baked.exposure`
- **THEN** it finds two positive gains, `editing` and `walk`, applied by the player to the lightmap of a baked surface only
