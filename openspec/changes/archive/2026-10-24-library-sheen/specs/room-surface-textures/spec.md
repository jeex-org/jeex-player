## MODIFIED Requirements

### Requirement: PBR facts applied

The drawn material SHALL apply the PBR facts by glTF rules, defaulting metalness to 0, roughness to 1 and alpha mode to `opaque`; a scalar multiplies its map, a scan's `baseColour` multiplies its colour map, and `mask` cuts at 0.5.

#### Scenario: Absent metalness
- **WHEN** a scan with `arm` and no `pbr.metalness` is drawn
- **THEN** it renders non-metallic whatever the ARM blue channel holds

#### Scenario: Metalness one
- **WHEN** a scan with `pbr.metalness: 1` is drawn
- **THEN** the ARM blue channel decides the metalness per texel

#### Scenario: Physical fields promote the material
- **WHEN** a material carries any of sheen, sheenColour, sheenRoughness, clearcoat, clearcoatRoughness, transmission, ior, thicknessM, attenuationDistanceM or attenuationColour
- **THEN** it is drawn with the physical material model so the field takes effect

#### Scenario: IOR only
- **WHEN** a material carries only `ior: 1.5` among the physical fields
- **THEN** it is drawn with the physical material model and its index of refraction is 1.5

#### Scenario: Mask cutoff
- **WHEN** a material with `alphaMode: 'mask'` is drawn over a map whose alpha is 0.4 in one half and 0.6 in the other
- **THEN** the first half is cut away and the second is opaque

## ADDED Requirements

### Requirement: Sheen lobe

A material that states sheen facts SHALL draw them as the physical material's `sheen`, `sheenRoughness` and `sheenColor`. A stated `sheenColour` SHALL be taken in linear light like every library colour. A stated `sheen` without `sheenColour` SHALL take the draw's tint (the finish colour, else the first suggested colour), or white when the material has no tint. An absent `sheenRoughness` SHALL leave three's default of 1.

#### Scenario: Stated sheen facts
- **WHEN** a cloth material states `sheen: 0.3`, `sheenRoughness: 0.6` and `sheenColour: '#d0c8b8'`
- **THEN** its physical material has sheen 0.3, sheen roughness 0.6 and the linear sheen colour of `#d0c8b8`

#### Scenario: Tinted sheen without a colour
- **WHEN** a tintable scan with recipe `luma-mid@1`, drawn in `#5a6b8c`, states `sheen: 0.3` and no `sheenColour`
- **THEN** its sheen colour is the linear colour of `#5a6b8c` itself, without the recipe's map gain

#### Scenario: Suggested colour as the tint
- **WHEN** such a scan is drawn with no finish colour
- **THEN** its sheen colour is the linear colour of its first suggested colour

#### Scenario: Untinted sheen without a colour
- **WHEN** a natural material states `sheen: 0.3` and no `sheenColour`
- **THEN** its sheen colour is white

#### Scenario: Sheen roughness alone
- **WHEN** a material carries only `sheenRoughness: 0.6` among the physical fields
- **THEN** it is drawn with the physical material model and its sheen roughness is 0.6
