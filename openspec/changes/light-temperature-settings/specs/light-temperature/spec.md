## ADDED Requirements

### Requirement: Temperature value

The viewer SHALL hold one light temperature: «Original» (the default) or a whole number of kelvin from 2700 to 6500 in steps of 100. «Original» SHALL render exactly as the viewer did before temperatures existed.

#### Scenario: Default is original
- **WHEN** a viewer mounts without a temperature
- **THEN** its state reports «Original» and every frame matches the previous release pixel for pixel

#### Scenario: Out of range or off step
- **WHEN** a host sets 2000, 7000, 3050 or a non-number
- **THEN** the value is refused with a viewer error naming the option and the temperature does not change

### Requirement: What the temperature tints

A temperature SHALL change the colour of the interior's artificial light only (the asset bank's lamps and the walk and tour ambient floor), keeping each light's luminance; the sun, the sky and hemisphere light, the fill light, the studio environment, reflections of it, and material previews SHALL NOT change.

#### Scenario: Warm and cold
- **WHEN** a lamp-lit grey card is shown at 2700 K and at 6500 K
- **THEN** its colour is redder at 2700 K and bluer at 6500 K than at 4000 K, with luminance within 5 %

#### Scenario: Previews unchanged
- **WHEN** the temperature changes
- **THEN** material swatches and the reference rig render unchanged

### Requirement: Setting and reporting the temperature

A host SHALL set the temperature by the mount option `lighting.temperature`, the attribute `light-temperature` (a number or `original`), the query parameter `lightTemperature`, the handle method `setLightTemperature(number | null)` and the iframe protocol; the viewer SHALL report it in its state and with a `lightTemperatureChange` event whenever it changes, from the host or from the panel.

#### Scenario: Attribute updates live
- **WHEN** a host sets `light-temperature="3000"` on a mounted element
- **THEN** the light changes and `lightTemperatureChange` reports 3000

#### Scenario: Panel change reported
- **WHEN** the viewer's user moves the panel's slider to 5000
- **THEN** `lightTemperatureChange` reports 5000 and the state reads 5000

#### Scenario: Iframe
- **WHEN** a host sets the temperature through the iframe protocol
- **THEN** the framed viewer changes and the event reaches the host
