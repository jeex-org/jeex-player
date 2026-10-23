## ADDED Requirements

### Requirement: Colour temperature in the standard

The standard SHALL publish the temperature range (2700–6500 K, step 100, default «Original») and a pure function that converts a temperature to a linear RGB colour normalised to unit luminance (Y = 0.2126 R + 0.7152 G + 0.0722 B), using Helland's approximation decoded from sRGB. The appearance version SHALL stay 1.

#### Scenario: Reference values
- **WHEN** the function converts 2700 K and 4000 K
- **THEN** it returns about [2.02, 0.78, 0.19] and [1.47, 0.91, 0.56], each with luminance 1

#### Scenario: Version unchanged
- **WHEN** a consumer reads the appearance version
- **THEN** it is 1
