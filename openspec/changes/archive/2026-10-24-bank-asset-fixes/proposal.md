# Proposal

## Why

The built-in bank is where the store and the studio take an object's size and placement facts from, and five of its objects disagree with themselves: a chair half a metre taller than its dims with floating rear posts, a media unit lower than its dims whose screen reads teal and whose brass bezel reads as a gold board, three plants fitted short of their declared height, and three fixtures whose taps make an exported bounding box decide how high they block.

## What Changes

- Dining chair: the rear posts stand on the floor and reach the declared height; the back slat and rail sit on them.
- Media unit: dims height is the built height (1.366 m; 1.512 m for the wide variant); a new near-black glossy TV screen finish without glow; bezel in the screen's glass, stand in the `leg` finish instead of the handles' `metal` slot.
- Plants: crowns are fitted on vertex-exact bounds, so every plant is exactly as tall as its dims (the ficus gains 9 cm).
- Island, vanity, bath: `layout.blockingHeight` is the carcass top (0.94, 0.88, 0.58 m); no footprint fraction, because the tap never widens the plan.
- Vanity: the vessel basin is open, as its builder intends.
- The round mirror is unchanged: its glass is built and reflects; the glassless and mustard objects seen in an exported project come from that path.

## Capabilities

### New Capabilities

- `bank-object-facts`: the built-in bank's objects agree with their own declared dims and layout facts, and its TV and fixtures read as what they are.

### Modified Capabilities

None. The floor-footprints rules are unchanged; this change only fills facts they already read.

## Impact

Bank data and builders under `src/assets/` and one new finish row under `src/materials/`. No scene schema, viewer option, public API or export changes. The demo flat looks different where these objects are visible, so canvas screenshot baselines that show them move.
