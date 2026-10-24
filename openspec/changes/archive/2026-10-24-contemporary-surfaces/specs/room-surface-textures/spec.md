# Spec Delta

## MODIFIED Requirements

### Requirement: Decode checks

A texture SHALL be decoded without colour conversion or alpha premultiplication; its decoded longer side SHALL equal its named size and its shorter side SHALL be that size divided by a power of two (1, 2, 4 and so on), the map of a rectangular tile; a mismatch or a decode failure SHALL leave the surface flat with a warning.

#### Scenario: Wrong pixel size
- **WHEN** a file listed as 512 decodes to 500 by 512
- **THEN** it is not used and the surface stays flat

#### Scenario: Rectangular tile
- **WHEN** a file listed as 256 of a material whose tile is 3.6 by 1.8 m decodes to 256 by 128
- **THEN** it is drawn, one image per tile
