# Brainstorm

## Problem

In walk and tour, glossy floors in the demo apartment's living room look matte: a polished floor (roughness 0.07) and a satin one (0.6) show the same uniform peach sheen, and the bay window does not appear in them. The ceiling of the same room reads peach rather than warm white at the default walk start. The change makes polished finishes read as polished in walk and gives the walk picture a fixed camera white balance, without extra GPU cost on phones and without touching the editing modes.

## Related work

1. The walk room lighting (room grids, one box-projected reflection probe per room, the walk rig) and the walk post-processing chain exist and are loaded lazily; this change rides on both.
2. A parallel change makes orbit draw on demand (render demand, its verifier); it lands first and this branch rebases onto it.
3. A parallel change adds a host sky (HDRI) to walk and tour; it touches the probe patch, the room probes, the walk lighting module and the walk rig, and it owns the brightness of the capture background and facades. This change keeps its edits in those files minimal and leaves the capture background to it.
4. Lamp lights (point lights from shared lamp facts) and the light-temperature setting exist; the lamp's emission shape is not modelled.

## Doubts

1. Whether the matte look comes from the probe's mip or roughness curve, from the 128 px probe resolution, from a missing exterior in the capture, from the box projection, or from specular occlusion.
2. Whether mean specular over ceiling brightness is a valid gloss metric at all.
3. How the reflection probe is placed, and whether a 2D footprint test can tell a low sofa from a floor lamp's shade.
4. Whether a furniture edit in walk re-captures the probe at the right place.
5. Why the ceiling is peach: walk exposure, sun, environment, the lamp, or the room grid.
6. Which fix for the ceiling is honest: lower lumens, a shade transmission profile, point shadows, or a camera white balance.
7. Phones: memory and capture cost of any fix.

## Approaches considered

1. **Probe placement with 3D clearance from furniture** (author, refined by partner). Evidence: the living room's probe sits 9 cm from the floor lamp's emissive shade, which fills the probe's whole upward face and hides the bay window; a re-capture 1 m away restored the window and the room in the mirror floor (contrast 1.0 → 3.2). The placement only tests plan footprints and does not know heights. Cost: CPU search over the same lattice at load and edit; zero GPU and capture cost.
2. **Larger probes, 256 px** (author). Evidence: the stair-stepped edges appear only on mirror-like finishes; the atlas would grow from about 16 MB to 63 MB and capture time two to four times. Not the cause of the matte look.
3. **Capture the exterior at the display level** (author). Evidence: captures see the window 3.5 times brighter than the screen does; this makes reflections brighter, not more matte, and the host sky change decides the capture background per state.
4. **Gloss judged by contrast, not by mean** (author and partner). Evidence: a GGX prefilter conserves energy, so the mean specular hardly depends on roughness in a dim room with one bright window (×1.1 with an honest probe); contrast p99/median does (×2.8), and so does a window reflection in a pose where geometry puts one.
5. **Placement refresh after furniture edits** (partner). Evidence: an edit in walk re-captures its room's probe at the position computed at load, so moving the lamp next to the probe never moves the probe.
6. **Ceiling: lower lamp lumens** (author). Evidence: the floor lamp's point light gives about half the ceiling's radiance and alone moves its R/B from 1.47 to 2.09; but nothing shows the authored output is wrong, the conversion is already a calibration, and a weaker lamp also weakens its legitimate pools.
7. **Ceiling: shade transmission as an angular mask on the point light** (author and partner). The right physical model eventually, but an open top passes full upward light, so it would not make the ceiling directly above less warm; it needs a shared lamp-fact extension and its own cross-repository change.
8. **Ceiling: point shadows** (author). The asset loader forces shadows off, fabric is not an occluder in a shadow map, and a cube shadow costs six depth renders per update.
9. **Ceiling: a fixed partial camera white balance in the walk output pass** (partner). A warm ceiling under a 3400 K lamp is physically right before the eye adapts; a camera balances it. One matrix multiply folded into the existing output pass, no extra pass or target, calibrated once on neutral surfaces under the mixed light of the walk start, keeping some warmth.

## Decision

Approaches 1, 5 and 9, judged by approach 4:

1. **Probe placement keeps 0.5 m of 3D clearance from furniture boxes.** The Euclidean distance from the probe point at the existing probe height to each furniture box; furniture footprints gain height bounds without changing the room-decomposition rectangle type. Among qualifying lattice points the existing wall-distance score decides; when none qualifies, the point with the largest minimum clearance (walls included) wins, with deterministic ties. The 0.5 m is a target, not a guarantee. One reflection probe per room stays; baked rooms use the same placement, since their specular uses probes; the diffuse grid is unchanged.
2. **Placement refreshes after furniture edits**: the edit recomputes placement from the current furniture bounds and updates the capture position and every associated box's probe position.
3. **A walk-only camera white balance**: a fixed partial chromatic-adaptation matrix, applied once to the final image inside the walk output pass before tone mapping and sRGB encoding; never inside probe or grid captures or lightmaps; editing modes unchanged. It is calibrated by measurement on neutral surfaces (the ceiling, the white walls) at the demo apartment's walk start, keeps some warmth (the ceiling reads warm white, not peach), and is checked on coloured furniture and the window.
4. **Standard and versions**: the lighting standard's values and version 1 stay; the white balance is a new walk value. The walk material transform's version changes only if its GLSL changes; neither placement nor the output pass does.

## Rejected

1. 256 px probes: memory and capture time for a defect that only mirror finishes show.
2. Capture background at the display level: belongs to the host sky change, which decides it per state.
3. Mean specular over ceiling as the gloss metric: blind to roughness by energy conservation.
4. Lower lumens: no evidence the authored output is wrong, and it weakens the lamp's legitimate pools.
5. Shade emission profile now: needs a shared lamp-fact extension and a cross-repository change; goes to its own change together with the glowing-shade contract.
6. Point shadows: forced off by the loader, fabric is not an occluder, six depth renders per update.
7. Automatic, view-dependent white balance: unnecessary complexity for one fixed camera.
8. More reflection probes per room: selection and blending work plus atlas memory, with no evidence they are needed once placement is fixed.

## Process

One round with an independent second agent on the diagnosis (measured in the browser on the GPU, the shots taken only once the walk lighting was live); the partner corrected the bake attribution (runtime grids hide furniture and its lamps, so lamp changes need a probe re-capture, not a grid re-bake), added the placement refresh and proposed the white balance. No disagreement was left open.
