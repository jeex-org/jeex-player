# Proposal

## Why

In walk and tour every room is lit the same way: light that ignores walls (a hemisphere light, a shadowless fill and the studio environment's diffuse) makes a windowless bathroom as bright as the living room, and glossy surfaces reflect a grey studio instead of the room. Room-aware reflections and bounce light are the largest realism gain left before lamps and sky.

## What Changes

- In walk and tour: one light-probe grid per room (three's WebGL probe grid), baked on entry over several frames, supplies diffuse indirect light, including one bounce through doorways.
- In walk and tour: one reflection probe per room, captured after the grids, packed into one atlas and sampled with box projection chosen per fragment, blended across doorways, supplies specular reflections.
- In walk and tour the hemisphere and fill lights are dimmed to zero and the environment's diffuse is switched off; a small ambient floor and a walk exposure factor keep rooms readable. Editing modes are unchanged; leaving walk restores them exactly.
- Shell meshes get origins inside their rooms (world-space geometry unchanged), so each mesh is lit by its own room's grid.
- The direct look is shown until the bake finishes, then one swap frame.

## Capabilities

### New Capabilities

- `walk-room-lighting`: room grids, room reflection probes, the walk rig, bake and refresh behaviour, and what captures show.

### Modified Capabilities

None (the lighting standard's values and the editing look are unchanged).

## Impact

New modules in the walk chunk (room volumes, grid bake, room probes, box-projection patch, controller), a post-build pass over shell meshes, the walk chain's output exposure, debug surface members for tests. No new dependency; the lazy chunk grows.
