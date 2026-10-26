## MODIFIED Requirements

### Requirement: PBR values and ranges

`facts.pbr` SHALL accept only `baseColour`, `roughness`, `metalness`, `alphaMode` (`opaque`, `blend`, `mask`), `opacity`, `sheen`, `sheenColour`, `sheenLift`, `sheenRoughness`, `clearcoat`, `clearcoatRoughness`, `transmission`, `ior`, `thicknessM`, `attenuationDistanceM`, `attenuationColour`, `emissive` and `emissiveIntensity`. Colours SHALL be `#rrggbb`; ranges are in the scenarios.

#### Scenario: Unit-interval values
- **WHEN** any of roughness, metalness, opacity, sheen, sheenLift, sheenRoughness, clearcoat, clearcoatRoughness or transmission is below 0 or above 1
- **THEN** the manifest is refused

#### Scenario: Sheen roughness accepted
- **WHEN** `sheenRoughness` is 0, 1 or a value between them, with or without the other sheen fields
- **THEN** the manifest is accepted

#### Scenario: Sheen lift accepted
- **WHEN** `sheenLift` is 0, 1 or a value between them
- **THEN** the manifest is accepted

#### Scenario: Index of refraction
- **WHEN** `ior` is below 1 or above 2.333
- **THEN** the manifest is refused

#### Scenario: Non-negative distances and intensity
- **WHEN** `thicknessM`, `attenuationDistanceM` or `emissiveIntensity` is below 0
- **THEN** the manifest is refused

#### Scenario: Non-finite number
- **WHEN** any numeric field is `NaN` or infinite
- **THEN** the manifest is refused
