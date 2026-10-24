# light-temperature Specification

## Purpose
The colour temperature of the interior light in kelvin: the range, the «Original» value that keeps the authored light, how lamps and the walk room lighting take it, and how a host sets and reads it through options, attributes, the handle, events and the iframe protocol.

## Requirements

### Requirement: Temperature value

The viewer SHALL hold one light temperature: «Original» (the default) or a whole number of kelvin from 2700 to 6500 in steps of 100. «Original» SHALL restore every artificial light's colour exactly as it was before temperatures existed (the walk sun factor of capability `walk-room-lighting` is separate).

#### Scenario: Default is original
- **WHEN** a viewer mounts without a temperature
- **THEN** its state reports `lightTemperature: null` and every artificial light has its original colour; editing-mode frames match the previous release pixel for pixel

#### Scenario: Out of range or off step
- **WHEN** the viewer is at 5000 K and a host sets 2000, 7000, 3050, NaN or a non-number by any path
- **THEN** the temperature stays 5000 K, `setLightTemperature` throws a viewer error with code `bad-params` and path `lightTemperature`, an invalid attribute or query value logs one warning and is ignored, and no change event fires

### Requirement: What the temperature tints

A temperature SHALL change the colour of the interior's artificial light only (the asset bank's lamps and the walk and tour ambient floor), keeping each light's luminance; the sun, the sky and hemisphere light, the fill light, the studio environment, reflections of it, and material previews SHALL NOT change.

#### Scenario: Warm and cold
- **WHEN** a lamp-lit grey card is shown at 2700 K and at 6500 K
- **THEN** its colour is redder at 2700 K and bluer at 6500 K than at 4000 K, with luminance within 5 %

#### Scenario: Previews unchanged
- **WHEN** the temperature changes
- **THEN** material swatches and the reference rig render unchanged

### Requirement: Captures

Stills and panoramas of the live state SHALL show the current temperature; stills of a default state, which build their own scene, SHALL apply the current temperature to that scene's artificial lights.

#### Scenario: Default-state still
- **WHEN** a still of the default state is captured at 2700 K
- **THEN** its bank lamps have the 2700 K colour

### Requirement: Setting the temperature

A host SHALL set the temperature by the mount option `lighting.temperature`, the attribute `light-temperature` (a number or `original`; removing it means «Original»), the query parameter `lightTemperature`, `setLightTemperature(number | null)` and the iframe command `setLightTemperature` with `{ temperature }`.

#### Scenario: Attribute updates live
- **WHEN** a host sets `light-temperature="3000"` on a mounted element
- **THEN** the light changes and `lightTemperature` reports `{ temperature: 3000, source: 'host' }`

#### Scenario: Iframe
- **WHEN** a host sets the temperature through the iframe protocol
- **THEN** the framed viewer changes and the event reaches the host

### Requirement: Reporting the temperature

The viewer SHALL report the temperature as `getState().lightTemperature` and with the event `lightTemperature` (`{ temperature: number | null, source: 'host' | 'panel' }`; element event `jeex-light-temperature`, iframe protocol event key `lightTemperature` in the embed event map) on every change, never on an unchanged value.

#### Scenario: Panel change reported
- **WHEN** the viewer's user moves the panel's slider to 5000
- **THEN** `lightTemperature` reports `{ temperature: 5000, source: 'panel' }` and the state reads 5000

#### Scenario: Unchanged value
- **WHEN** a host sets the temperature it already has
- **THEN** no event fires
