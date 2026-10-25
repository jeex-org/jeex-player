## MODIFIED Requirements

### Requirement: Sheen lobe

A material that states sheen facts SHALL draw them as the physical material's `sheen`, `sheenRoughness` and `sheenColor`. A stated `sheenColour` SHALL be taken in linear light like every library colour. A stated `sheen` without `sheenColour` SHALL take the draw's tint (the finish colour, else the first suggested colour) lerped toward white in linear light by the fixed sheen lift of 0.2, or white when the material has no tint. An absent `sheenRoughness` SHALL leave three's default of 1.

#### Scenario: Stated sheen facts
- **WHEN** a cloth material states `sheen: 0.3`, `sheenRoughness: 0.6` and `sheenColour: '#d0c8b8'`
- **THEN** its physical material has sheen 0.3, sheen roughness 0.6 and the linear sheen colour of `#d0c8b8`

#### Scenario: Tinted sheen without a colour
- **WHEN** a tintable scan with recipe `luma-mid@1`, drawn in `#5a6b8c`, states `sheen: 0.3` and no `sheenColour`
- **THEN** its sheen colour is the linear colour of `#5a6b8c` lerped toward white by 0.2, without the recipe's map gain

#### Scenario: Suggested colour as the tint
- **WHEN** such a scan is drawn with no finish colour
- **THEN** its sheen colour is the linear colour of its first suggested colour lerped toward white by 0.2

#### Scenario: Untinted sheen without a colour
- **WHEN** a natural material states `sheen: 0.3` and no `sheenColour`
- **THEN** its sheen colour is white

#### Scenario: Sheen roughness alone
- **WHEN** a material carries only `sheenRoughness: 0.6` among the physical fields
- **THEN** it is drawn with the physical material model and its sheen roughness is 0.6
