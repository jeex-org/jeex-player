## MODIFIED Requirements

### Requirement: Texture file paths

Every texture file path SHALL be exactly `tex/<versionId>/<role>.<px>.<ext>`, where `versionId` is the material's own, `role` is the map's role, `px` is the size key it is listed under and `ext` is `webp` or `ktx2`; it is a relative path inside the manifest folder. Every file of one material SHALL use the same extension.

#### Scenario: Another version's folder
- **WHEN** a material's file path names a different material's `versionId`
- **THEN** the manifest is refused

#### Scenario: Size key and file disagree
- **WHEN** the file listed under size `512` is `tex/<versionId>/albedo.256.webp`
- **THEN** the manifest is refused

#### Scenario: KTX2 maps
- **WHEN** every file of a material is `tex/<versionId>/<role>.<px>.ktx2`
- **THEN** the manifest is accepted

#### Scenario: Mixed formats in one material
- **WHEN** a material lists its albedo as `.ktx2` and its normal map as `.webp`
- **THEN** the manifest is refused

#### Scenario: Other extension
- **WHEN** a file path ends in `.png`
- **THEN** the manifest is refused
