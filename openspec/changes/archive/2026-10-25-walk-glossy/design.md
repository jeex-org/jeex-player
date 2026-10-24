# Design

## Context

See proposal.md for the motivation and the evidence. The state this design builds on:

1. `src/render/walk-lighting/room-volumes.ts` `probePoint` walks a bounded lattice (`plan/search-lattice.ts`, 0.1 m step, widening with the room) over the room polygon and keeps the point farthest from the room's edges, preferring points outside every furniture footprint. Footprints are plan `Rect`s (`src/app/walk-lighting-wiring.ts` `volumeInput`, from `Box3.setFromObject` of each child of the furniture group); heights are dropped, so a sofa and a floor lamp block the same way, and a point 9 cm beside a lamp shade is "free".
2. `WalkLighting.load` computes the volumes once; `refresh(scope)` re-captures probes at the positions from that load. `setRoomBoxes` writes each box's `jeexProbe` (the projection centre) from the same positions. The room grids and the box layout depend only on the rooms, never on furniture.
3. The walk chain (`src/render/walk-post.ts`) ends in three's `OutputPass`, whose `OutputShader` reads the linear half-float buffer, applies the renderer's tone mapping (PBR Neutral, with exposure) and the sRGB transfer, and rebuilds its defines at the first render.
4. Probe, grid and lightmap captures render the scene directly, never through the chain. Panoramas also take the direct path: a cube camera into a half-float cube, then one display pass (`still-capture.ts` `displayMaterial`) that tone-maps and encodes.

## Goals / Non-Goals

**Goals:**

1. A reflection probe point that keeps a 3D clearance from furniture, with a deterministic fallback.
2. Probe points that follow furniture edits in walk, in the capture and in the projection uniforms, in the same frame.
3. A fixed, measured, luminance-preserving white balance in the walk output, at zero extra GPU cost.

**Non-Goals:**

1. Lamp emission shape, lamp lumens, point shadows, emissive shade brightness.
2. More probes per room, larger probes, probe atlas layout.
3. The capture background and facade brightness during captures (the host sky change owns them).
4. White balance in a panorama's cube faces, in the editing modes, or adaptive per view.
5. Re-capturing the probe of a room a piece of furniture left when that room's probe point does not move (unchanged from today).

## Decisions

### 1. Furniture boxes and clearance

`room-volumes.ts` gains `export type FurnitureBox = Rect & { minY: number; maxY: number }`; `VolumeInput.furniture` becomes `readonly FurnitureBox[]`. `Rect` itself and `rectilinearBoxes` are unchanged. `volumeInput` fills `minY`/`maxY` from the same `Box3`.

`WALK_LIGHTING_TUNING.probeClearanceM = 0.5`.

For each lattice point inside the polygon, with `p = (x, probeHeightM, z)`:

- `furnitureClearance` = the minimum over furniture boxes of the Euclidean distance from `p` to the box (zero inside it; `+∞` without furniture);
- `edge` = `edgeDistance(point, polygon)` as today;
- `qualifies` = `furnitureClearance ≥ probeClearanceM`;
- `score` = today's score (`edge` minus the small pull towards the room's middle).

Choice, in this order: a qualifying point beats a non-qualifying one; among qualifying points the higher `score` wins (today's rule); among non-qualifying points the higher `min(furnitureClearance, edge)` wins, then the higher `score`; an exact tie keeps the earlier lattice point, and the lattice order is fixed, so the answer is deterministic.

Alternatives: a 2D footprint grown by the clearance (rejected: a low sofa would push the probe away for nothing, and a tall shelf's top would not count); a point on the far side of the lamp only (rejected: special-cases one asset kind); several probes per room (rejected: selection and blending work plus atlas memory, with no evidence they are needed).

Cost: lattice points times furniture boxes, per room, CPU only, at load and after an edit. Measured on the demo plan (9 rooms, 59 furniture boxes): 25–42 ms for the whole apartment, against 8 ms without furniture. Accepted as is; no culling.

### 2. Placement refresh after furniture edits

The controller's handle contract becomes `refresh(scope, doc)`: the controller passes `this.deps.document()` (the current furniture) with the merged scope. `WalkLighting.refresh`:

1. When `doc` is present, compute `roomVolumes(doc.volumes)`. If it fails, or its boxes differ from the loaded ones (count or any projection box), the rooms changed under an edit the scope did not call `all`: `load(doc)` and return (a full re-bake, as for a plan change).
2. Otherwise compare each room's new probe point with the loaded one; `moved` is the set of rooms whose point changed by more than 1 mm. Write the new positions into the loaded `RoomProbe` objects (the `RoomProbes` instance reads them at capture time) and call `setRoomBoxes` again, which rewrites every box's `jeexProbe` from them. Uniform writes only: no program change.
3. Then the existing path: a full or early refresh restarts (now with current points); a live refresh re-bakes the scope's grids and re-captures `scope.grids ∪ scope.probes ∪ moved`, synchronously in the same frame, so the uniforms and the captured tiles never disagree on screen.

The relight path (light temperature) does not touch placement. The edit in `walk-lighting.ts` is confined to `refresh`; the HDRI branch's changes there are elsewhere in the file, and the rebase resolves any overlap by keeping both.

Alternative: recompute placement inside the lighting from the furniture group it already holds (rejected: duplicates `volumeInput` and its plan reads).

### 3. White balance: matrix, calibration, storage

A pure module `src/render/white-balance.ts` (no `three`, no DOM) exports `whiteBalanceMatrix(source: RGB, degree: number): Mat3` (row-major, linear Rec. 709 primaries, D65 white):

1. Convert the measured source white (linear RGB) to XYZ, then to Bradford cone responses; the target white is the display white, linear RGB (1, 1, 1) at the source's luminance.
2. Von Kries scaling with partial degree `D`: each cone gain is `D · target / source + (1 − D)`.
3. Back to linear RGB: `M = RGB←XYZ · B⁻¹ · diag(gains) · B · XYZ←RGB`.
4. Luminance preservation: with `y` the Rec. 709 luminance row (0.2126, 0.7152, 0.0722) and `u = (1, 1, 1)ᵀ` (`y·u = 1`), `M' = M + u (y − yM)`, so `y M' = y` for every input colour, and `M' s = M s` for the source white (since `y M s = y s`). The guarantee is exact before clipping only: the shader clamps negative channels to zero afterwards, which raises the luminance of a very saturated colour (for source (2, 1.5, 1) at degree 0.5, pure blue gains about 23 %). The tests state the matrix's preservation on the matrix, and the on-screen tolerance on neutral patches and view means, with the clamp in every expected value.

Bradford over CAT16: the standard choice for display white points, simplest to verify against published matrices; the difference at this degree is below the measurement noise.

Storage: `WALK_POST_TUNING.whiteBalance = { source: [r, g, b], degree }`, with a comment that records the pose, the date, the meter, the measured ceiling and wall values and the resulting ceiling R/B before and after. The matrix is computed from them when the walk chunk evaluates; a test pins it against a value computed independently in the test from the same inputs (the «Reproducible matrix» scenario). It is a walk value: `LIGHTING_STANDARD` and its version do not change.

Calibration (in the browser, on the GPU, once the walk lighting is live, at the demo apartment's walk start with the default sun preset and lamps):

1. Meter in the linear domain with the white balance at identity: preferably read the chain's linear half-float colour buffer before the output pass directly (scene linear times nothing: the output pass applies the exposure). Where a byte read-back is used instead (renderer tone mapping switched to linear, exposure lowered so nothing clips), the output pass still applies the sRGB transfer, so each byte is decoded with the sRGB EOTF and divided by the exposure actually set. The domain and the exposure are recorded with the numbers.
2. Mask the living-room ceiling and the white walls in view (by mesh), take the luminance-weighted mean linear RGB: that is `source`.
3. Choose `D` so the ceiling's white-balanced red over blue lands at 1.45, the middle of the acceptance band 1.3–1.6, by bisection on the helper; check red ≥ green ≥ blue.
4. Re-meter with the matrix on: ceiling R/B in the band; a saturated furniture finish keeps its dominant channel; the sky in the window is not warmer than before. Record before and after.

### 4. Where the matrix sits

The `WalkPost` constructor keeps three's stock `OutputPass` and patches its material: `whiteBalancedOutput` rewrites the stock `OutputShader` fragment source, inserting, right after `gl_FragColor = texture2D( tDiffuse, vUv );`, the line `gl_FragColor.rgb = max( jeexWhiteBalance * gl_FragColor.rgb, vec3( 0.0 ) );` with a `uniform mat3 jeexWhiteBalance`. The anchor is matched exactly and a missing anchor throws at construction (a three upgrade that changes the shader fails loudly in the tests, not silently in the picture). The matrix applies before tone mapping (exposure is a scalar inside it, so the order against exposure does not matter) and before the sRGB transfer. One multiply per pixel in an existing pass; no pass, target or texture is added; the defines rebuild at the first render is unchanged, so `quadMaterials` keeps excluding the output material.

`WalkPost` takes an optional `whiteBalance` matrix (default: the tuned one) and exposes it read-only; the `PostProcessor` contract gains an optional `readonly whiteBalance?: readonly number[]` (nine numbers, row-major), so a chain without one keeps the contract. The walk-post component tests that compare the chain with the direct path (open floor, mirror) pass the identity. Captures through the chain (`renderTo`) use the same pass, so stills and video carry the balance. Captures of probes, grids and lightmaps never go through the chain, so they stay unbalanced by construction.

Panoramas: `displayFragment`/`displayMaterial` take an optional matrix; with one they declare `uniform mat3 jeexWhiteBalance` and apply the same line before the tone mapping. `capturePanorama` takes an optional `whiteBalance` in its spec. The panorama command asks `deps.postChain()` like the still command does and passes the chain's matrix when there is one (walk and tour); outside them, or without a chain, the panorama is unchanged. The cube faces are still rendered directly, unbalanced; only the final display pass changes. Stills on the direct path (no chain) stay unbalanced, as today's direct path is the editing look.

### 5. Versions

`WALK_TRANSFORM.version` goes from 3 to 4, once, for the two GLSL changes of this delivery: the emissive cap (decision 6) and the bump-normal guard (decision 7). Placement and the output pass do not touch the material transform. `LIGHTING_STANDARD` values and version 1 are unchanged.

## Risks / Trade-offs

1. [The white balance changes every walk and tour screenshot] → expected; walk baselines that change are listed and re-shot only after the change is accepted; editing-mode and chrome baselines must stay unchanged.
2. [A panorama waits for the chain to load, as a still already does] → the same wait and the same fallback; without a chain it is captured unbalanced.
3. [The fixed matrix is calibrated on one pose and one sun preset] → partial adaptation keeps it moderate; the window and coloured furniture are checked; an evening preset is looked at during calibration and its readings recorded.
4. [Luminance projection can push a very saturated colour negative in one channel, and the clamp then raises its luminance] → preservation is promised before the clamp only; the on-screen scenarios meter neutral patches and view means, and the expected values include the clamp.
5. [A crowded room leaves no 0.5 m clear point] → the largest-clearance fallback; the 0.5 m is a target.
6. [Rebase with the HDRI branch in `walk-lighting.ts`] → this change edits only `refresh` there; conflicts resolved by keeping both. The «With a host sky» scenario is tested after that branch is on main: the refresh must keep its fixed atlas mip, its tile-size check and its rig transitions.

### 6. Walk emissive cap (added after the independent review round)

Measured in walk before tone mapping, the shades' brightest channel is ivory 2.30, opal 3.70, warm lamp 6.66, ink 0.789; the display knee is 0.76. One uniform factor cannot fit all four (they would need about 0.16, 0.084, 0.039 and 0.95). So the walk transform caps the emissive term instead: `E × min(1, cap / max(E))`, chroma kept, emissive below the cap untouched (ink keeps its glow). The cap is one walk value in `walk-lighting-tuning.ts`, chosen by measurement so every shade meets both bounds (total brightest channel ≤ 0.76 with the bulb's lit part included, and ≥ 1.25× the shade with emissive off). It is applied through the shader composer on the emissive term, while the rig is in the walk or the capture state (a uniform the rig sets: the cap over the walk exposure in walk and in probe and grid captures, which record the walk look; 1e9, uncapped, in the editing state), so editing, orbit and `plan3d` glow stay exact; `WALK_TRANSFORM.version` is bumped once for this change (decision 5). The finish catalogue is not touched. Measured: a cap of 0.3 meets both bounds for all four shades. A dimmer shade changes the ceiling and the probe blob, so the white-balance calibration is redone after the cap.

### 7. A zero bump normal in captures (found by the placement)

The WC's new probe point exposed a latent defect: from it, the hall shoe cabinet's natural oak (a bump map) falls on the edge column of a capture cube face, where a software rasteriser's screen derivatives vanish; three r186's bump perturbation (`perturbNormalArb`) then normalises a zero vector, the one NaN texel spreads through the prefilter over the whole probe, and the WC's surfaces render black. It is not a light inside a fixture and not the placement's own doing: any probe there would hit it. The walk transform replaces the bump chunk's final normalisation with one that keeps the surface normal when the perturbed vector vanishes (same chunk otherwise; a missing anchor fails loudly). `WALK_TRANSFORM.version` goes to 4 once, for this and the emissive cap together.

### 8. Gloss acceptance on the current demo

The room's surfaces changed after the first measurement (lighter default walls and ceiling), which brightens the floor's whole reflection and lowers its contrast; the contrast is measured on the current demo. Acceptance on the recorded living-room pose and black floor: r 0.07 contrast at least 2.2 times r 0.6 (measured 2.28: 4.79 against 2.10), and that ratio at least 1.15 times the ratio with the probe at the footprint rule's point (2.70, 1.50, 7.13) (measured 2.28 against 1.83, 1.25 times), which pins what the placement changed. The old point is a constant in the test, not a second implementation of the old rule.
