# Proposal

## Why

A selected object can only be swapped for a variant of its own design, and a long list of variants runs off the viewer. The owner asked for every variation to be reachable, and for a way to replace the object with a different asset, chosen from a popup grouped by category. The player has no catalogue beyond what the scene places and no operation that changes an object's asset while keeping its id.

## What Changes

- New scene op `replace_asset`: the placement keeps its id, room, position, rotation and mirror and takes another asset. No id is minted.
- New viewer option and attribute `offers`: an extra library in the existing project-library format, given inline or by URL. Without it, the bundled bank is offered.
- The renderer, the validator and the panels look up assets in the project library, then in offers, then in the bundled bank.
- The Replace panel's variant list scrolls within the viewer, so every variant is reachable.
- A new "Replace with another…" button below the variants opens a titled popup that lists assets with the same anchor, grouped by category. It works with a keyboard and on a phone.

## Capabilities

### New Capabilities

- `asset-replace-op`: what `replace_asset` keeps, changes, drops and refuses.
- `asset-offers`: the `offers` option, its loading and validation, and the lookup order.
- `replace-panel`: the Replace panel's reachability, the new button and the popup.

### Modified Capabilities

None.

## Impact

- Code: scene types, schema, ops and diff; the validator's registries; the asset resolver and project wiring; viewer options and element attributes; the selection panel, panel requests and a new popup module; messages in every locale; viewer CSS.
- Public API: a new op in `jeex-viewer/ops`, a new option and attribute, and new `jeex-edit` payloads. The scene schema version is unchanged, because the op is not stored in the scene.
- Consumers: jeex-studio builds the `offers` library and applies `replace_asset` (its validator is this package).
- No new dependency. Tailwind stays out.
