# Proposal

## Why

Authors want the apartment's interior light warmer or colder, like choosing LED lamps, and the viewer has no place for general settings yet. In walk and tour, direct sunlight on interior floors comes close to clipping.

## What Changes

- A colour temperature for the interior's artificial light (the asset bank's lamps and the walk ambient floor), 2700–6500 K in 100 K steps, or «Original» (today's look, the default). Daylight, the sky, the studio environment and material previews do not change.
- A settings panel in the viewer's own UI, opened by a settings button attached next to «Interior style»; hidden unless the host turns it on. Its first setting is the light temperature.
- Host contract: mount options `settings` and `lighting.temperature`, attributes `settings` and `light-temperature`, query parameters, `setLightTemperature`, the value in the viewer state, a `lightTemperature` event, and the same through the iframe protocol.
- In walk and tour, direct sunlight inside rooms is scaled so floors no longer clip; the editing look is unchanged.

## Capabilities

### New Capabilities

- `light-temperature`: the temperature value, what it tints, how it is set and reported.
- `viewer-settings-panel`: the settings button and panel.

### Modified Capabilities

- `lighting-standard`: publishes the temperature range and the kelvin-to-colour function.
- `walk-room-lighting`: direct sunlight inside rooms in walk and tour.

## Impact

`src/lighting/` (standard data, a pure colour-temperature module, exports), lamps of the asset bank, the walk lighting (ambient floor colour, sun factor in the shader patch, probe re-capture), `src/ui/` (settings button and panel, shell, chrome), viewer options, schema, resolvers, the custom element, the handle, events, the iframe protocol, locales (seven catalogues), the local demo, README and CHANGELOG. No new dependency.
