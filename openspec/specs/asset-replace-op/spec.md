# asset-replace-op Specification

## Purpose
What the `replace_asset` scene op keeps, changes, drops and refuses when a placement takes a different asset under the same id, and how it commits.

## Requirements

### Requirement: Replace keeps the placement

`replace_asset { assetId, asset, library?, variant? }` SHALL keep the placement's `id`, `room`, `position` (verbatim), `rotationY` and `mirror`. It SHALL set `type` and `asset` to the target, set `library` and `variant` when given and remove them when absent, and remove `finishes`, `material`, `scale` and `collision`. It SHALL NOT mint an id.

#### Scenario: Sofa replaced by another sofa
- **WHEN** a sofa with a finish override and a collision override is replaced by another sofa archetype from offers
- **THEN** the placement keeps its id, position, rotation and mirror, names the new asset, the offers library and no variant, and carries no finishes or collision

#### Scenario: On-surface vase keeps its height
- **WHEN** a vase standing on a table at y 0.75 is replaced by another on-surface object from offers
- **THEN** its y stays 0.75

### Requirement: Replace refuses incompatible targets

`replace_asset` SHALL be refused, leaving the scene unchanged, when the placement is unknown, the asset or variant does not resolve in a loaded library, the target's anchor or on-surface flag differs from the current asset's, or the placement's mirror is not allowed by the target.

#### Scenario: Different anchor
- **WHEN** a floor sofa is replaced by a ceiling pendant
- **THEN** the op is refused and the sofa is unchanged

#### Scenario: Variant of another asset
- **WHEN** the variant named does not belong to the target asset
- **THEN** the op is refused

### Requirement: Replace is one revision

`replace_asset` SHALL commit as one revision. Interior presets SHALL forget their `replace_asset_variant` ops and their finish-setting `set_object` ops for that placement in the same revision. Under `edits: 'emit'` the op SHALL go to the host in `jeex-edit` and the document SHALL stay unchanged.

#### Scenario: Preset forgets the old variant
- **WHEN** a preset recorded a variant for the sofa and the sofa is replaced
- **THEN** the preset holds no `replace_asset_variant` for the sofa, and the scene's revision advanced by one

#### Scenario: Emit mode
- **WHEN** the viewer runs with `edits: 'emit'` and a replacement is picked
- **THEN** a `jeex-edit` event carries the `replace_asset` op and the document is unchanged
