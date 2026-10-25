# Design

## Context

See proposal.md (Why). The state this design starts from, against three r186.1:

- `GridBake.step` hides every object `bakeExclusions` returns (the furniture group, mirrors, transmissive meshes) by `visible = false` for the slice. Three stops traversing at an invisible object, so every light under the furniture group (fact lights are children of the body, bank bulbs children of the builder's group) is missing from both grid passes.
- The walk shader transform (`box-probe-patch.ts`, `WALK_TRANSFORM`) locates each fragment's room boxes (`jeexLocate`, the lookup point pushed along the normal, tested against the selection boxes) but only as "inside some room" (`jeexInRoom`). It does not touch point lights.
- `light-order.ts` mirrors three's per-type light order per render and camera; `baked-surface.ts` turns it into shared per-point-light uniforms through a draw hook on each baked material, cached per (render frame, scene, camera).
- `WalkLighting.refresh` re-captures only probes for an asset edit; `relight()` (light temperature) re-captures only probes.

## Goals / Non-Goals

Goals: one lamp scope shared by display, grid capture and reflection capture; no room-specific program; correct invalidation; measured calibration.

Non-goals: spot, area and IES lights; emitter slots and visibility metadata; point-light shadows; furniture self-shadowing; one render per room; selective lamp-bounce dependency tracking; quality tiers and the phone light budget; any change in the editing modes.

## Decisions

### 1. Layer exclusion in the grid bake

`bakeExclusions` stops returning the furniture group. Instead the grid bake takes a second list, the furniture meshes: every `isMesh` under the furniture group (shades included). For the slice:

1. record each mesh's `layers.mask`;
2. set it to `0`, so it fails every camera's layer test; its ancestors stay visible, and three keeps traversing into its children, so the lights under it are collected and lit as in display;
3. bake;
4. in `finally`, write every recorded mask back (before the rig returns to `editing`), whether the bake returned or threw.

Mirrors and transmissive meshes keep today's `visible` exclusion (a mirror under furniture is also a mesh, so it is excluded both ways; the restore order is masks first, then visibility, and each restores only what it changed).

Lights are not touched: their own layers still pass, so `light-order.ts` collects them in the same order three does. The light count of a capture equals the display's, so no program changes.

Reflection probes do not use this list: they capture furniture as today, with the emissive cap of the capture state.

Alternative rejected: `visible = false` per mesh, which drops the lights under a mesh body; capture-only light copies, which change the light count and so the programs.

### 2. Runtime lamp inventory and room assignment

A new pure module `render/walk-lighting/lamp-rooms.ts` (no three, no DOM):

- `assignLampRoom(position: {x, z}, rooms: readonly VolumeRoom[], order: readonly string[]): number` answers the index of the source room in `order` (the probe order, which is the room order and the atlas tile order): the first room in `order` whose polygon contains the point, boundary included (a point on an edge counts as inside, measured with a 1e-6 m tolerance); `-1` when none does. The polygon is the room polygon of the volume input, never a sampling or selection box.
- A lamp signature: `lampSignature(entries)` turns the inventory into a string of `(uuid, world position at 1 mm, linear colour at 1e-4, intensity at 1e-4, distance, decay)` in traversal order, so any lamp move, removal, addition, swap or tint changes it.

The inventory itself lives in the walk lighting module: `runtimeLamps(scene)` walks the scene and keeps every `isPointLight` that carries the artificial-light tag (`isArtificialLight`): fact lights and bank bulbs alike; the walk's ambient floor is an `AmbientLight` and is not a lamp. `collectLampLights()` is not used and does not change.

On every `load` and `restart` the walk lighting assigns each runtime lamp its room index and writes it to `light.userData.jeexLampRoom` (`-2` for "a lamp in no room"); it keeps the signature it assigned from. A light without `jeexLampRoom` (any other point light a host adds) stays ungated.

### 3. The shader gate

Uniforms, all shared through the scene's walk uniforms object (no per-room define, no program key):

| Uniform | Type | Meaning |
|---|---|---|
| `jeexLampScope` | float | 1 from walk entry to walk exit (through the warm-up and the captures), 0 in the editing modes |
| `jeexBoxRoom[JEEX_MAX_BOXES]` | float | the room index of each box, written by `setRoomBoxes` beside the probe index it already writes |
| `jeexPointRoom[NUM_POINT_LIGHTS]` | float | per drawn point light, in three's order: its room index, `-2` for a lamp in no room, `-1` for a light that is not a lamp |

Receiver room: `jeexLocate` keeps its loop and also records `jeexRoom`, the room index of the first box (in box order, the same order three's grids use) whose selection box contains the lookup point; `-1` outside every box. One loop, no second lookup.

Gate: the walk transform appends to the anchor `getPointLightInfo( pointLight, geometryPosition, directLight );` (already pinned for the baked policy, which finds it as a landmark and still does after this line is added):

```glsl
directLight.color *= jeexLampGate( jeexPointRoom[ i ] );
```

with `jeexLampGate(r) = 1` when `jeexLampScope < 0.5` or `r < -0.5 && r > -1.5` (not a lamp), else `(r > -0.5 && abs(r - jeexRoom) < 0.5) ? 1 : 0`. Scaling `directLight.color` before `RE_Direct` removes both the diffuse and the specular term of that light, and nothing else. The gate sits inside the `#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )` guard like the rest of the walk transform, and `jeexPointRoom` is declared under `#if NUM_POINT_LIGHTS > 0`. The transform's version goes from 5 to 6.

Alignment with three's order: `light-order.ts` grows one output, `pointRoom: number[]`, filled in the same loop as `point` from `userData.jeexLampRoom` (`-1` when absent). The per-render update moves out of `baked-surface.ts` into one shared updater (cached per render frame, scene and camera, as today), which writes both the baked masks and `jeexPointRoom`. The walk patch installs that draw hook on every material it patches, as the baked mark does; a copy that already carries the walk transform gets the draw hook when `installWalkPatch` next finds it. So a capture camera, a nested render (a mirror) and the return to the outer render each get their own order, exactly as the baked masks do today.

Scope switch: `WalkRig` sets `jeexLampScope` to 1 when the walk lighting is installed for walk or tour and to 0 on `dispose`/leaving, independently of `setUniformState`, so the editing-state slices of the warm-up are gated too, and the editing modes stay pixel-identical.

Why at the receiver: a probe in room B sees room A's surfaces through the doorway, and those fragments are located in A, so they keep A's lamp; B's fragments reject it. Bounce crosses openings, direct light stops at the room boundary, and the result does not depend on where the camera or the capture point is.

### 4. Invalidation

- `WalkLighting.refresh(scope, doc)`: before the selective path, compare `lampSignature(runtimeLamps(scene))` with the one assigned at the last load or restart; on a difference call `restart()` (grids, then probes), which re-assigns rooms. A furniture edit that leaves every lamp unchanged keeps today's selective probe refresh.
- `WalkLighting.relight()` (the temperature, after its settle time) becomes a full `restart()`: the grids hold tinted lamp bounce.
- A restart shows the direct look until the bake ends, as an entry does; that is the accepted cost of a lamp edit in walk.

### 5. Transport and lightmaps

Direct lamp diffuse + direct lamp specular + grid bounce. No term is removed for lamps; the grid's first pass records lamp-lit surfaces, which is bounce relative to the direct term. The baked policy is unchanged: a baked surface ignores the grid and drops the diffuse of a lamp marked baked; the gate multiplies on top, so a foreign-room lamp adds nothing at all there.

### 6. Concave rooms

Delivered rule: room equality. Task 6 checks the supported scenes (the demo apartment and the plan fixtures) for a room with more than one box that holds a lamp, and tests in walk whether a surface behind an inner corner within the lamp's cutoff is visibly lit. If one is, a conservative segment test is added, only for multi-box rooms: the receiver keeps the lamp when the segment from the light to the lookup point stays inside the union of the room's selection boxes (sampled at a fixed count per box, a uniform-driven loop); its cost is measured. If none is, the limit is written into the README and the spec stands as written.

### 7. Calibration

Method:

1. Same scene (demo apartment), finishes, sun preset, HDRI state, camera poses, resolution and renderer before and after; the renderer string is recorded with every number. Gloss and white-balance suites refuse software renderers; their numbers come only from a hardware run.
2. "Before" is main; "after" is this branch.
3. Each state is measured twice: **daylight-only** (every runtime lamp at intensity 0, then a fresh bake) and **lamps-on** (authored intensities at the default temperature, then a fresh bake). Lamp intensities and the temperature are recorded.
4. A lamp-isolated reading (a card in a lamp-lit room, lamps-on minus daylight-only, with the grid frozen and with the direct term gated) separates direct, grid and combined lamp contributions.
5. The windowless/window grey-card fixture stays a daylight control (its lamps off), with its targets unchanged.
6. The white balance's source colour is measured again in the lamps-on state; only if the corrected ceiling leaves 1.3–1.6 or breaks R ≥ G ≥ B is the source re-recorded by the existing calibration procedure. Exposure, ambient floor, sun factor, lamp units and the emissive cap stay unless an independent daylight measurement justifies a change. Gloss thresholds, poses, masks and roughness never move; a physically justified conflict is reported for an acceptance decision, not tuned away.

Table (targets frozen; the four reading columns are filled by the tasks):

| Measurement | Target | Before, daylight | Before, lamps | After, daylight | After, lamps |
|---|---|---|---|---|---|
| Windowless / window grey card | ≤ 0.35 | | n/a (control) | | n/a (control) |
| Window room walk / editing grey card | 0.25–0.45 | | n/a | | n/a |
| Ceiling raw R/B at the walk start | recorded 2.086 ±5 % (re-recordable) | | | | |
| Ceiling corrected R/B | 1.3–1.6, R ≥ G ≥ B | | | | |
| Furniture and window hue guards | dominant channel kept; sky not warmer | | | | |
| Shade mean brightest channel (4 finishes) | ≤ 0.76 | | | | |
| Shade lit / unlit luminance | ≥ 1.25 | | | | |
| Floor contrast 0.07 / 0.6 | ≥ 2.2 | | | | |
| Contrast ratio vs footprint-rule probe | ≥ 1.15 | | | | |
| Window band in the polished floor | brighter than beside | | | | |
| Sunlit floor clipped pixels (noon) | < 1 % | | | | |
| Sunlit floor luminance deviation vs editing | ≥ 80 % | | | | |
| Reference rig 0.18 card | unchanged | | | | |

Costs reported beside the table, before and after, lamps on: bake time (`stats.bakeMs`, `bakeFrames`, probe frames and ms), warmed display cost (mean frame ms over forced frames in a warmed walk view), draw calls (`renderer.info.render.calls`) and program count (`renderer.info.programs.length`).

## Risks / Trade-offs

- [A surface in no room box (door leaves in the wall thickness, the outer face of a window frame) takes no lamp light in walk] → the lookup point is pushed along the normal into the room it faces; door leaves and frames are checked in the doorway shot; outside the rooms the facade keeps the editing look anyway.
- [The scene's lights are traversed once per render and camera, many times per grid slice] → the cache per (frame, scene, camera) is shared with the baked masks; the bake time is measured before and after.
- [A lamp edit or temperature change in walk shows the direct look for the length of a re-bake] → accepted by the decision; the bake time is reported.
- [Shadow map refresh during a capture slice would miss furniture meshes] → the same holds today with the hidden furniture group; the sun shadow is cached and not refreshed inside a slice; unchanged.
- [Materials without a cube-UV environment get no gate] → in walk every patched material has the scene's environment; the same guard already limits every walk feature.
- [Light order drifts on a three upgrade] → the adapter is pinned and checked by the baked-surface component test, which gains a room case.
- [Room equality is not wall occlusion in a concave room] → decision 6.

## Migration Plan

None: no data, API or option changes. Rollback is reverting the change.
