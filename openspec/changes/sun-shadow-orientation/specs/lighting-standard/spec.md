## MODIFIED Requirements

### Requirement: Apartment rig

The apartment rig SHALL contribute the neutral environment at the apartment intensity, a hemisphere light, a shadow-casting directional sun and a shadowless directional fill, with values defined by the standard. It is the rig of the player's scenes, including captures of a scene's default state. Its sun SHALL be controllable: a caller sets the direction towards the sun and the sun's shadow frustum; until it does, the sun keeps the standard's default direction and frustum. Shadow caching SHALL be off unless the rig options enable it.

#### Scenario: Apartment rig contribution
- **WHEN** an apartment rig is attached to an empty scene
- **THEN** the scene has the standard environment at the apartment intensity, one hemisphere light, one shadow-casting directional sun and one shadowless directional fill, with the standard's colours, intensities and positions

#### Scenario: Sun direction set
- **WHEN** a caller sets the sun direction of an apartment rig to a unit vector
- **THEN** the light travels along the opposite of that vector, its shadow is marked for redraw, and the fill, hemisphere and environment are unchanged

#### Scenario: Existing consumer keeps live shadows
- **WHEN** an apartment rig is created without the caching option and a caster moves between two renders without any call to the rig
- **THEN** the second render shows the moved shadow

#### Scenario: Cached shadow
- **WHEN** an apartment rig is created with caching enabled
- **THEN** its sun's shadow is drawn on the first render and afterwards only after the rig is told it is dirty or one of its setters runs

#### Scenario: Shadow frustum set
- **WHEN** a caller sets the sun's shadow frustum from a fit result
- **THEN** the sun, its target and the shadow camera's up vector are those of the fit, the shadow camera's six planes equal the fit's, its projection is updated, and every fitted box projects inside the shadow map

#### Scenario: Invalid sun input
- **WHEN** a caller sets a zero, non-finite or downward-pointing sun direction, or a frustum with a non-finite or empty extent
- **THEN** the call throws a lighting error with code `bad-options` and the sun is unchanged

### Requirement: Rig options

An apartment rig SHALL accept an optional shadow map size: an integer power of two from 256 to 4096, default 2048, lowered to the renderer's maximum texture size when that is smaller; and an optional boolean `shadowCache`, default false. The rig SHALL report its effective shadow map size. Any other value or any unknown option SHALL fail with the `bad-options` error before anything is allocated or any scene is changed.

#### Scenario: Default size
- **WHEN** an apartment rig is created without options
- **THEN** the sun's shadow map is 2048 × 2048

#### Scenario: Rejected size
- **WHEN** an apartment rig is created with a shadow map size of 0, 1000, 8192, 2048.5, NaN or a string
- **THEN** creation throws a lighting error with code `bad-options` naming the option

#### Scenario: Effective size
- **WHEN** an apartment rig asks for 4096 on a renderer whose maximum texture size is 2048
- **THEN** the rig reports an effective shadow map size of 2048

#### Scenario: Unknown option
- **WHEN** an apartment rig is created with an option the standard does not define
- **THEN** creation throws a lighting error with code `bad-options`

### Requirement: Published description and version

The entry SHALL publish a read-only description of the standard (engine revision, display transform, calibration target, environment parameters, rig values, sun presets and shadow tuning values) and an appearance version number, raised with every intentional change of the look. The entry SHALL export the lighting error type and its codes.

#### Scenario: Description is read-only
- **WHEN** a consumer tries to change a value of the published description, at any depth
- **THEN** the value does not change

#### Scenario: Version
- **WHEN** a consumer reads the appearance version
- **THEN** it stays 1: the additions are data and functions that change no existing rig value

## ADDED Requirements

### Requirement: Sun presets

The standard SHALL publish three sun presets as azimuth clockwise from north and elevation above the horizon, in degrees: `morning` 90/20, `noon` 180/55, `evening` 270/20.

#### Scenario: Presets published
- **WHEN** a consumer reads the published description
- **THEN** it finds the three presets with exactly these angles

### Requirement: Sun direction

A pure function SHALL turn a north angle and a preset into the unit direction towards the sun in world axes and its world azimuth and elevation: for `W = north + azimuth` and elevation `E`, the direction is `[sin W cos E, sin E, cos W cos E]`. With no orientation it SHALL return the standard's default direction.

#### Scenario: Noon with north along +Z
- **WHEN** the direction is computed for north 0 and preset `noon`
- **THEN** it points to world azimuth 180° (towards −Z) at 55° elevation

#### Scenario: North rotates the sun
- **WHEN** the direction is computed for north 90 and preset `morning`
- **THEN** its world azimuth is 180°, its elevation 20°

#### Scenario: No orientation
- **WHEN** the direction is computed without an orientation
- **THEN** it equals the normalised legacy direction `[4.5, 15.5, -11.5]`

### Requirement: Shadow frustum fit

A pure function SHALL fit an orthographic shadow frustum for a sun direction and an effective shadow map size to axis-aligned world boxes: light-space bounds of every box corner, padded by the standard, light upstream of every box, near at least the standard's minimum, a camera up vector of +Y (−Z when the sun is within 1° of the zenith), and bias and normal bias from the larger world texel side. It imports no three.js.

#### Scenario: Every box inside the frustum
- **WHEN** a frustum is fitted to a set of boxes for any upward sun direction
- **THEN** every corner of every box lies inside the frustum's six planes with at least the padding to spare

#### Scenario: Smaller plan, finer texels
- **WHEN** frustums are fitted for the same direction to a 6 m and a 24 m square plan
- **THEN** the world texel of the first is smaller than that of the second

#### Scenario: Map size changes texel bias
- **WHEN** the same plan is fitted with map sizes 1024 and 4096
- **THEN** the normal bias of the first is at least that of the second, both within the standard's clamp

#### Scenario: Zenith sun
- **WHEN** a frustum is fitted for a sun straight overhead
- **THEN** the fit uses −Z as the camera's up vector and every box is still inside

#### Scenario: Matches a real shadow camera
- **WHEN** a fit is applied to a three.js directional light and its shadow camera matrices are updated
- **THEN** every fitted box corner projects inside the shadow camera's clip volume

#### Scenario: Empty or invalid input
- **WHEN** a frustum is fitted to no boxes, a box with a non-finite coordinate or min greater than max, a zero, non-finite or non-upward direction, or a map size that is not a positive integer
- **THEN** the function throws a lighting error with code `bad-options`
