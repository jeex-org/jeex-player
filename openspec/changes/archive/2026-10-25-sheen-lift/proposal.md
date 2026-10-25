# Proposal

## Why

A cloth that states a sheen but no sheen colour draws its sheen in its own tint. On dark dyed fabrics that sheen is nearly invisible at grazing angles, while the sheen of real dyed fibre is lighter than its body colour.

## What Changes

- A stated `sheen` without `sheenColour` takes the draw's tint lerped toward white in linear light by a fixed lift of 0.2, named `SHEEN_LIFT`.
- Not changed: an explicit `sheenColour` is used as stated; an untinted material's sheen stays white; the legacy asset finishes, whose cloth finishes all state their sheen colour.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `room-surface-textures`: the sheen colour default of the sheen lobe.

## Impact

- Code: `src/materials/library-material.ts`.
- Tests: the sheen lobe unit tests.
- No API, schema or option change; no new dependency. Library cloth that states a sheen without a colour draws a slightly lighter sheen; no repository fixture or screenshot states one.
