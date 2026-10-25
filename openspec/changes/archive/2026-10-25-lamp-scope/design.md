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

`bakeExclusions` stops returning the furniture group and stops hiding anything under it. The grid bake takes a second list, the furniture renderables: every `isMesh` under the furniture group, shades, transmissive bodies and mirrors included. For the slice:

1. record each renderable's `layers.mask`;
2. set it to `0`, so it fails every camera's layer test; nothing under the furniture group changes `visible`, so three keeps traversing into the children and every lamp under a body is collected and lit as in display;
3. bake;
4. in `finally`, write every recorded mask back (before the rig returns to `editing`), whether the bake returned or threw.

Mirrors and transmissive meshes outside the furniture group keep today's `visible` exclusion; no lamp is nested under them. Lights are not touched: their own layers still pass, so `light-order.ts` collects them in the same order three does, and with an unchanged light configuration a capture uses the display's light count and programs.

Reflection probes do not use this list: they capture furniture as today, with the emissive cap of the capture state.

Alternative rejected: `visible = false` per mesh, which drops the lights under a mesh body (a transmissive body included); capture-only light copies, which change the light count and so the programs.

### 2. Runtime lamp inventory and room assignment

A new pure module `render/walk-lighting/lamp-rooms.ts` (no three, no DOM):

- `assignLampRoom(position: {x, z}, rooms: readonly VolumeRoom[], order: readonly string[]): number` answers the index of the source room in `order` (the probe order, which is the room order and the atlas tile order): the first room in `order` whose polygon contains the point, boundary included (a point on an edge counts as inside, with a 1e-6 m tolerance); `-1` when none does. The polygon is the room polygon of the volume input, never a sampling or selection box. There is no nearest-room fallback: a lamp outside every polygon lights nothing in walk and feeds no grid.
- `lampSignature(entries)` turns the inventory into a string of `(uuid, world position at 1 mm, linear colour at 1e-4, intensity at 1e-4, distance, decay)` in traversal order, so any lamp move, removal, addition, swap or tint changes it and nothing else does.

The inventory itself lives in the walk lighting module: `runtimeLamps(scene)` walks the scene and keeps every `isPointLight` that carries the artificial-light tag (`isArtificialLight`): fact lights and bank bulbs alike; the walk's ambient floor is an `AmbientLight` and is not a lamp. `collectLampLights()` is not used and does not change.

On every `load` and `restart` the walk lighting assigns each runtime lamp its room index and writes it to `light.userData.jeexLampRoom` (`-2` for "a lamp in no room"); it keeps the signature it assigned from. A light without `jeexLampRoom` (any other point light a host adds) stays ungated.

Wall-mounted lamps: before the gate lands, every supported wall-mounted lamp fact (the bundled lamp fixtures and the playground lamps) is placed against a wall and its emitter checked against the room polygon. An emitter outside the polygon by mistake is reported for a correction of the fact in the asset source; the player does not compensate. A bounded mounting-side rule is added only if a supported asset needs its emitter in the wall thickness on purpose, and only after that is agreed.

### 3. The shader gate

Uniforms, all shared through the scene's walk uniforms object (no per-room define, no program key):

| Uniform | Type | Meaning |
|---|---|---|
| `jeexLampScope` | float | 1 from walk entry to walk exit (through the warm-up and the captures), 0 in the editing modes |
| `jeexBoxRoom[JEEX_MAX_BOXES]` | float | the room index of each box, written by `setRoomBoxes` beside the probe index it already writes |
| `jeexPointRoom[NUM_POINT_LIGHTS]` | float | per drawn point light, in three's order: its room index, `-2` for a lamp in no room, `-1` for a light that is not a lamp |

Receiver room: `jeexLocate` keeps its loop and also records `jeexRoom`. For each box it already computes the inside distance `d` of the lookup point (the surface point pushed `jeexPush` along the normal); a box with `d ≥ 0` is a candidate (the existing `jeexInRoom` keeps its strict `> 0`). Among candidates of different rooms, the owner is the room whose box gives the larger inside distance at the point pushed a second `jeexPush` further along the normal (the room the face points into); on an exact tie, the lower room index. `-1` when no box contains the lookup point. The boxes are not widened: selection boxes already reach the wall centreline and 0.2 m past floor and ceiling.

What this means for the parts in a wall:
- a wall face, floor, ceiling, skirting and furniture against a wall: the lookup point lies inside its own room's box, so it takes its own room;
- a door leaf and a frame: each face's normal points into the room it faces, which owns it; a jamb lying exactly on the shared centreline with its normal along the boundary is a tie and takes the lower room index;
- a window reveal: the part up to the wall centreline lies in the room's box and takes the room; the part beyond it lies outside every box and takes no lamp light, like the facade.

Gate: the walk transform appends to the anchor `getPointLightInfo( pointLight, geometryPosition, directLight );` (already pinned for the baked policy, which finds it as a landmark and still does after this line is added):

```glsl
directLight.color *= jeexLampGate( jeexPointRoom[ i ] );
```

with `jeexLampGate(r) = 1` when `jeexLampScope < 0.5` or `r` is `-1` (not a lamp), else `(r > -0.5 && abs(r - jeexRoom) < 0.5) ? 1 : 0`. Scaling `directLight.color` before `RE_Direct` removes both the diffuse and the specular term of that light, and nothing else. The gate sits inside the `#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )` guard like the rest of the walk transform, and `jeexPointRoom` is declared under `#if NUM_POINT_LIGHTS > 0`, so no zero-length array is declared; three substitutes the light count and unrolls `[ i ]`. The transform's version goes from 5 to 6.

Alignment with three's order: `light-order.ts` grows one output, `pointRoom: number[]`, filled in the same loop as `point` from `userData.jeexLampRoom` (`-1` when absent). The per-render update moves out of `baked-surface.ts` into one shared updater (cached per render frame, scene and camera, as today), which writes both the baked masks and `jeexPointRoom`, with the current length and order on every render. The walk patch installs that draw hook on every material it patches, as the baked mark does; a copy that already carries the walk transform gets the draw hook when `installWalkPatch` next finds it. So a capture camera, a nested render (a mirror) and the return to the outer render each get their own order, exactly as the baked masks do today.

Programs: a room index is a uniform value, so room changes need no variant. A change in the light count or the shadow layout may select new programs, as it does today; the constant-program claims hold only for an unchanged light configuration.

Scope switch: `WalkLighting.frame` sets `jeexLampScope` to 1 on every eligible frame with rooms to light (walk or tour, the bake included) and to 0 on an ineligible frame, a plan without rooms and `dispose`, independently of `setUniformState`, so the editing-state slices of the warm-up are gated too, and the editing modes stay pixel-identical.

Why at the receiver: a probe in room B sees room A's surfaces through the doorway, and those fragments are located in A, so they keep A's lamp; B's fragments reject it. Bounce crosses openings, direct light stops at the room boundary, and the result does not depend on where the camera or the capture point is.

### 4. Invalidation

- Edits: `refreshScope` today drops an asset whose room the updated model cannot name (a removed asset, or one moved out of every room), so nothing would reach the lighting. The scope gets a flag `lamps: boolean`, set by every asset edit, the room-less ones included; such a scope is never `null`. `WalkLighting.refresh(scope, doc)` with `lamps` set compares `lampSignature(runtimeLamps(scene))` with the one assigned at the last load or restart; on a difference it calls `restart()` (grids, then probes), which re-assigns rooms. A furniture edit that leaves every lamp unchanged keeps today's selective probe refresh. Tests go through the real move and remove commands, the last lamp and a move out of every room included.
- Temperature: the controller keeps a pending relight outside walk and tour (no heavy work in an editing mode). On the first eligible frame after a non-eligible one, a pending relight is handed over at once, before the frame is drawn, so entry never shows the old tint as live; while eligible, it waits for the settle time as today. `WalkLighting.relight()` compares the lamp signature: unchanged (the same temperature as baked) does nothing; changed restarts, the initial bake included.
- A restart shows the direct look until the bake ends, as an entry does.

Cost, not claimed in advance: with `N` grid probes and `R` rooms a full bake is two grid passes (about `ceil(2N / probesPerFrame)` slices, `12N` face renders) and then `R` reflection captures; this change keeps that schedule and adds lamp lighting and the gate to every capture. The report gives wall-clock time to `live` for a cold and a warm entry, temperature-settle-to-live, the worst slice in ms, and the counters (`bakeMs`, `bakeFrames`, `probeMs`, `probeFrames`); it draws no conclusion about cheapness, which belongs to the quality tiers.

### 5. Transport and lightmaps

Direct lamp diffuse + direct lamp specular + grid bounce. No term is removed for lamps; the grid's first pass records lamp-lit surfaces, which is bounce relative to the direct term. The baked policy is unchanged: a baked surface ignores the grid and drops the diffuse of a lamp marked baked; the gate multiplies on top, so a foreign-room lamp adds nothing at all there.

### 6. Concave rooms

Delivered rule: room equality. Task 6 audits the supported scenes (the demo apartment and the plan fixtures) for a room with more than one box that holds a lamp whose cutoff reaches a surface behind the room's inner corner, and meters that surface in walk. If one is visibly lit, a fix is required: a containment method shown to be correct for those rooms (not a fixed-count sampling of the segment, which can miss a crossing between samples), with its display and bake cost measured, designed and agreed before it is built. If none is, the limit is written into the README and the requirement stands as written.

### 7. Calibration

Method:

1. Same scene (demo apartment), finishes, sun preset, HDRI state, camera poses, resolution and renderer before and after; the renderer string is recorded with every number. Gloss and white-balance suites refuse software renderers; their numbers come only from a hardware run.
2. "Before" is main; "after" is this branch.
3. Each state is measured twice: **daylight-only** (every runtime lamp at intensity 0, then a fresh bake) and **lamps-on** (authored intensities at the default temperature, then a fresh bake). Lamp intensities and the temperature are recorded.
4. Lamp decomposition, three linear readings on a zero-specular card in a lamp-lit room, in a recorded mask and domain (linear, before tone mapping):
   - `A`: a fresh bake with every lamp off, read with lamps off (baseline);
   - `B`: a fresh bake with lamps on, read with every lamp's direct light suppressed (the gate forced to reject);
   - `C`: the same grid as `B`, read with direct light on.
   Then bounce = `B − A`, direct = `C − B`, combined = `C − A`.
5. The windowless/window grey-card fixture stays a daylight control (its lamps off), with its targets unchanged.
6. The ceiling's raw R/B (recorded 2.086) is a measured default-state baseline, not a target: it is measured again in the default state (lamps on, default temperature) and re-recorded with its evidence, whether or not the white balance needs retuning. The source colour is re-recorded by the existing procedure only if the corrected ceiling leaves 1.3–1.6 or breaks R ≥ G ≥ B.
7. A parameter changes only on evidence that fits it: shade readings for the emissive cap, daylight readings for exposure, ambient floor and sun factor; lamp units never change here. Gloss thresholds, poses, masks and roughness never move; a physically justified conflict is reported for an acceptance decision, not tuned away.

Table (targets frozen; the reading columns are filled by the tasks). Kind: **A** = acceptance check (fails the delivery), **D** = diagnostic reading (recorded, no pass/fail).

| Measurement | Target | Before, daylight | Before, lamps | After, daylight | After, lamps |
|---|---|---|---|---|---|
| Windowless / window grey card | ≤ 0.35 | A | n/a (control) | A | n/a (control) |
| Window room walk / editing grey card | 0.25–0.45 | A | n/a | A | n/a |
| Ceiling raw R/B at the walk start | baseline, re-recorded | D | D (default state) | D | D (default state, re-recorded) |
| Ceiling corrected R/B | 1.3–1.6, R ≥ G ≥ B | D | A | D | A |
| Furniture and window hue guards | dominant channel kept; sky not warmer | D | A | D | A |
| Shade mean brightest channel (4 finishes) | ≤ 0.76 | D | A | D | A |
| Shade lit / unlit luminance | ≥ 1.25 | D | A | D | A |
| Floor contrast 0.07 / 0.6 | ≥ 2.2 | D | A | D | A |
| Contrast ratio vs footprint-rule probe | ≥ 1.15 | D | A | D | A |
| Window band in the polished floor | brighter than beside | D | A | D | A |
| Sunlit floor clipped pixels (noon) | < 1 % | A | A | A | A |
| Sunlit floor luminance deviation vs editing | ≥ 80 % | A | A | A | A |
| Lamp bounce / direct / combined (`A`, `B`, `C`) | none | n/a | D | n/a | D |
| Reference rig 0.18 card | unchanged | A | n/a | A | n/a |

Costs reported beside the table, before and after, lamps on: the timings of decision 4, warmed display cost (mean frame ms over forced frames in a warmed walk view), draw calls (`renderer.info.render.calls`) and program count (`renderer.info.programs.length`).

## Risks / Trade-offs

- [The part of a window reveal beyond the wall centreline takes no lamp light] → accepted: it lies outside every room, like the facade; boxes are not widened across walls. Jambs, leaves, reveals and furniture against walls are pinned by rendered tests in display and in a capture.
- [An emitter a few millimetres into the wall lights nothing] → the supported wall-mounted facts are audited first; a wrong fact is corrected at its source, not compensated in the player.
- [The scene's lights are traversed once per render and camera, many times per grid slice] → the cache per (frame, scene, camera) is shared with the baked masks; the bake time is measured before and after.
- [A lamp edit or temperature change in walk shows the direct look for the length of a re-bake] → accepted by the decision; the wall-clock times of decision 4 are reported, with no cost claim beyond them.
- [Shadow map refresh during a capture slice would miss furniture meshes] → the same holds today with the hidden furniture group; the sun shadow is cached and not refreshed inside a slice; unchanged.
- [Materials without a cube-UV environment get no gate] → in walk every patched material has the scene's environment; the same guard already limits every walk feature.
- [Light order drifts on a three upgrade] → the adapter is pinned and checked by the baked-surface component test, which gains a room case.
- [Room equality is not wall occlusion in a concave room] → decision 6.

## Migration Plan

None: no data, API or option changes. Rollback is reverting the change.
