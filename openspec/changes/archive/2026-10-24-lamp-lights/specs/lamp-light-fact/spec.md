## ADDED Requirements

### Requirement: Lights are an optional variant fact

A variant of a player project manifest (`library.objects[].variants[]`) SHALL accept an optional `lights` array. Absent SHALL mean the variant emits no light. The manifest's `formatVersion` SHALL stay the literal 2, and every manifest valid before this change SHALL stay valid. The fact SHALL NOT exist on an object, on a scene placement or in the scene schema.

#### Scenario: Existing manifest
- **WHEN** a manifest written before this change, without any `lights`, is parsed
- **THEN** it is accepted exactly as before and every resolved asset has no lights

#### Scenario: Lamp variant with lights
- **WHEN** the lamp fixture `tests/fixtures/project-lamps/project.json` is parsed
- **THEN** it is accepted and its two variants each carry one point light

#### Scenario: Lights on an object
- **WHEN** a manifest puts `lights` on a library object instead of a variant
- **THEN** it is refused with an unknown-key issue on that object

### Requirement: Point light shape

Each entry of `lights` SHALL be a strict object discriminated by `kind`; this change defines only `kind: 'point'` with exactly the keys `position` (three finite numbers, metres), `colour` (`#rrggbb` sRGB, the «Original»), `lumens` (in (0, 10 000]), `cutoff` (in (0, 15] metres, where the light reaches zero) and optional `shadow` (boolean hint, default false).

#### Scenario: Keys of a point light
- **WHEN** a point light carries exactly `kind`, `position`, `colour`, `lumens`, `cutoff` and `shadow`
- **THEN** it is accepted

### Requirement: Light count, identity and decay

A variant SHALL carry 1 to 4 lights. A light SHALL carry no id: it is identified by its placement and its index. Decay SHALL NOT be a field; it is always 2.

#### Scenario: Minimal point light
- **WHEN** a variant carries `[{ "kind": "point", "position": [0, 0.443, 0], "colour": "#ffd9a4", "lumens": 400, "cutoff": 3 }]`
- **THEN** it is accepted and `shadow` reads as false

#### Scenario: Unknown kind
- **WHEN** a light says `"kind": "spot"`
- **THEN** the manifest is refused with an issue at that light's `kind`

#### Scenario: Extra key
- **WHEN** a point light carries `"decay": 2` or `"id"`
- **THEN** the manifest is refused with an unknown-key issue at that light

### Requirement: Model frame

A light's `position` SHALL be expressed in the model frame of its variant: the frame of the variant's delivered GLB and of its `dims` stand-in. That is metres, front facing −Z, origin at the centre of the floor footprint, y up from the lowest point of the model, for every anchor, before the placement's scale and mirror. A small negative y is legal.

#### Scenario: Pendant
- **WHEN** a ceiling pendant 1.052 m tall has its bulb 0.989 m below its top on its axis
- **THEN** its `position` is `[0, 0.063, 0]`

#### Scenario: Bulb just below the model
- **WHEN** a flush ceiling light's bulb sits 0.098 m below the model's lowest point
- **THEN** its `position` `[0, -0.098, 0]` is accepted

#### Scenario: Table lamp
- **WHEN** a floor-anchored table lamp's bulb sits 0.443 m above its base on its axis
- **THEN** its `position` is `[0, 0.443, 0]`

### Requirement: Validation refuses the manifest

The manifest schema SHALL refuse non-finite numbers, `lumens` at or below 0 or above 10 000, `cutoff` at or below 0 or above 15, a colour that is not `#rrggbb`, an empty `lights` array, more than 4 lights and unknown keys. A refused light SHALL refuse the whole manifest with an issue whose path names the variant and the light index, like every other fact of this strict format. There SHALL be no run-time lamp budget in this change.

#### Scenario: Too many lights
- **WHEN** a variant carries five lights
- **THEN** the manifest is refused with an issue at that variant's `lights`

#### Scenario: Out of range
- **WHEN** a light says `"lumens": 0` or `"cutoff": 20`
- **THEN** the manifest is refused with an issue at that light's field

#### Scenario: Not finite
- **WHEN** a light's position holds `NaN` or `Infinity` (a value built in code, since JSON cannot spell either)
- **THEN** the manifest is refused with an issue at that light's `position`

#### Scenario: Empty array
- **WHEN** a variant carries `"lights": []`
- **THEN** the manifest is refused; a variant without light omits the key

### Requirement: One lumen conversion

`jeex-viewer/lighting` SHALL export `lampCandela(lumens)` = `lumens / (4π) × LIGHTING_STANDARD.lamp.exposure` and `blenderPower(candela)` = `4π × candela` from `src/lighting/lamp-units.ts`, with `lamp.exposure` the constant for which 400 lumens give 1.2 candela. Every consumer SHALL convert lumens through these functions, never its own formula.

#### Scenario: Calibration point
- **WHEN** `lampCandela(400)` is computed
- **THEN** it equals 1.2 within 1e-9

#### Scenario: Bank pendant
- **WHEN** `lampCandela(600)` is computed
- **THEN** it equals 1.8 within 1e-9, the bank pendant's intensity today

#### Scenario: Entry exports
- **WHEN** the `jeex-viewer/lighting` entry's value exports are listed
- **THEN** they include `lampCandela` and `blenderPower`

### Requirement: Nominal lumens and the bake power

`blenderPower` SHALL stay in `lamp-units.ts`, marked unconfirmed until the calibration room's lamp landmark, for the lightmap bake's `bakeLights`. The player README SHALL say the lumens are nominal: 400 lm reads as 1.2 cd under `lamp.exposure`, not the physical 31.8 cd.

#### Scenario: Bake power
- **WHEN** `blenderPower(1.2)` is computed
- **THEN** it equals 4π × 1.2 within 1e-9

### Requirement: The standard's version stays

Adding `lamp.exposure` SHALL leave `LIGHTING_STANDARD_VERSION` at 1, because no rig value changes. A later change of exposure or tone mapping SHALL change `lamp.exposure` with it.

#### Scenario: Version
- **WHEN** this change has landed
- **THEN** `LIGHTING_STANDARD_VERSION` is 1 and every rig value of `LIGHTING_STANDARD` is unchanged

### Requirement: Colour is the authored Original

A light's `colour` SHALL be the colour the light has when the viewer's global temperature is «Original». The fact SHALL NOT carry a colour temperature in kelvin; a temperature is the viewer's global setting applied over the authored colour.

#### Scenario: Original restores the authored colour
- **WHEN** a lamp light authored `#ffd9a4` is tinted to 2700 K and the temperature is then set back to «Original»
- **THEN** the light's colour is `#ffd9a4` again
