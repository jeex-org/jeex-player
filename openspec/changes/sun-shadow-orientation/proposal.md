# Proposal

## Why

Sunlight in the player does not respect the apartment: the shadow frustum is a fixed square that clips large plans and wastes resolution on small ones, hidden ceilings and cut-away walls stop casting so the sun floods rooms from above in every overview, and the shadow map is redrawn every frame for a scene that does not move. Scenes also cannot say where north is, so the sun cannot be tied to the plan or to a time of day. Later lighting work (room probes, sky) needs a sun that agrees with the plan.

## What Changes

- The apartment rig's sun gets a typed control: set its direction and its shadow frustum. The standard publishes the fitting and direction math, the three sun presets and the shadow tuning values; its appearance version rises from 1 to 2.
- The player fits the sun's shadow to the apartment's casters and receivers, and caches the shadow map until something that casts or receives changes.
- Ceilings block the sun in every shell state through closed shadow-only casters; walls cut away by the dollhouse keep casting. Hidden casters are never drawn, never picked.
- Window glass never casts (already true; now pinned by a test).
- New optional scene field `site` with `northDeg` and a sun preset (`morning`, `noon`, `evening`), in scene schema version 2.3; 2.2 stays readable. Without `site`, the sun keeps today's direction.
- The look of existing scenes changes where sunlight used to pass through invisible ceilings and cut-away walls: intended.

## Capabilities

### New Capabilities

- `apartment-sun-shadow`: how the player's sun lights the apartment: direction from the scene's orientation, the fitted shadow, the cache and its invalidation, shadow-only casters in every shell state.
- `scene-site-orientation`: the scene document's optional orientation and sun preset field, its validation and defaults.

### Modified Capabilities

- `lighting-standard`: the apartment rig exposes sun direction and shadow frustum control; the standard publishes the sun presets, the direction and fitting functions and the shadow tuning values; appearance version 2.

## Impact

1. Code: `src/lighting/` (standard data, pure sun and fit functions, rig API), new player modules for render layers, the shadow-only adapter, ceiling casters and the sun shadow controller, the dollhouse, the render runtime and capture wiring, the scene types, schema, shape validator and generated JSON Schema.
2. Public API: the `jeex-viewer/lighting` entry gains functions and an apartment rig type; the scene schema gains version 2.3 with `site`. Consumers that build an apartment rig keep working unchanged.
3. No new dependency. The shadow pass adapter depends on three.js r186 behaviour and is pinned by browser tests.
