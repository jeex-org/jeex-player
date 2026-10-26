# Spec Delta

## MODIFIED Requirements

### Requirement: Replace refuses incompatible targets

`replace_asset` SHALL be refused, leaving the scene unchanged, when the placement is unknown, the asset or variant does not resolve in a loaded library, the target's anchor or on-surface flag differs from the current asset's, or the placement's mirror is not allowed by the target. The anchor refusal SHALL carry `detail.reason: 'anchor_mismatch'` with `assetId`, `mount` (the target's) and `currentMount`, each `floor`, `wall`, `ceiling` or `surface`.

#### Scenario: Different anchor
- **WHEN** a floor sofa is replaced by a ceiling pendant
- **THEN** the op is refused with `reason: 'anchor_mismatch'`, `mount: 'ceiling'`, `currentMount: 'floor'`, and the sofa is unchanged

#### Scenario: On-surface target
- **WHEN** a floor sofa is replaced by an on-surface vase
- **THEN** the op is refused with `mount: 'surface'`, `currentMount: 'floor'`

#### Scenario: Variant of another asset
- **WHEN** the variant named does not belong to the target asset
- **THEN** the op is refused
