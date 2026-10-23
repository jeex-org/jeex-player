# Proposal

## Why

Walk and tour, the modes visitors use to experience an apartment, show no contact shadows: corners, skirtings and furniture feet do not darken, so rooms look flat. Their edges alias. Editing modes must not pay for any fix.

## What Changes

- In camera modes `walk` and `tour` the player renders through a post-processing chain: ambient occlusion (GTAO) and SMAA, then the same PBR Neutral display transform as everywhere. Editing modes (`plan2d`, `plan3d`, `orbit`) keep rendering straight to the screen.
- The chain loads on first entry to `walk`/`tour`: a lazy chunk in the ES and demo builds, inline in the IIFE build. Until it is ready the view renders as today.
- Mirrors keep capturing exactly once per frame under the chain.
- Stills and video frames captured in `walk`/`tour` go through the same chain, so they match the screen; panoramas keep their current path.
- The chain follows resize, pixel ratio, context loss and restore, and disposes all its GPU resources.

## Capabilities

### New Capabilities

- `walk-post-processing`: what the player draws in walk and tour: the post-processing chain, when it is active, how it loads, what it applies to, and how mirrors and captures behave under it.

### Modified Capabilities

- `lighting-standard`: the display-transform requirement names the walk and tour chain as one more place the transform is applied once to the whole frame. The published lighting entry is unchanged.

## Impact

1. Code: new render modules for the post-processor contract and the walk/tour chain, an app-side controller for loading and lifecycle, a scene-pass scope in the shared layer, the mirror capture gate, the render runtime's frame seam, capture commands, the build's lazy-chunk budget.
2. Bundle: the ES and demo boot bundles unchanged, a new lazy chunk; the IIFE grows by the chain's size, within the 700 KB budget.
3. No new dependency (three's own addons).
