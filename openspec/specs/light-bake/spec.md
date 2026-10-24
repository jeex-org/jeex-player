# light-bake Specification

## Purpose
A light bake carries indirect light, and direct light from every lamp except the sun, baked offline into a second UV channel of the apartment shell. The viewer validates the bake's sidecar, checks that the shell it was made for is the shell it loads, uploads the atlas pages as linear RGBM, decodes them in the material before one application of the calibrated intensity, and binds them to the shell's materials as one transaction. The live direct sun and specular stay live, so nothing is lit twice. A calibration scene proves the intensity, the colour space, the row orientation and the sun split. Projects without a light bake are unchanged.

## Requirements

### Requirement: Sidecar boundary

The player SHALL accept a light bake only through its sidecar (format 1), judged before anything is loaded or changed. Ids are UUID v7 and are never minted by the player. The contract (UV channel 1 in atlas mode, top-down rows, RGBM linear non-colour with straight M decoded before the intensity, a mip limit, upload without flipping, premultiplication or colour conversion, the live-contribution policy) is closed: a contract the player does not implement refuses the whole bake.

#### Scenario: Calibration sidecar accepted
- **WHEN** the calibration fixture's sidecar is judged
- **THEN** it passes unchanged, with seven bindings and one baked lamp

#### Scenario: Unknown contract refused
- **WHEN** any contract field differs from what the player implements (another UV channel, bottom-up rows, another encoding, an sRGB upload, an extra key)
- **THEN** the sidecar is refused with a message naming that field, and nothing is loaded

### Requirement: Live policy and sun

The contract's live policy SHALL keep exactly `direct sun`, `specular` and `live-lamp light` and disable exactly `baked-lamp diffuse`, `fill`, `hemisphere`, `ambient`, `probe-grid diffuse` and `environment diffuse`, in any order, each once. The sidecar's sun SHALL be the unit direction the light travels (glTF frame, +Y up, length within 0.001 of 1), a non-negative linear Rec.709 colour and a non-negative irradiance in W/m².

#### Scenario: Other policy refused
- **WHEN** a live list misses a name, adds an unknown one or repeats one
- **THEN** the sidecar is refused, naming the list

#### Scenario: Bad sun refused
- **WHEN** the sun's direction is not a unit vector or its colour has a negative component
- **THEN** the sidecar is refused, naming the field

### Requirement: Sidecar consistency

A sidecar SHALL be refused unless every binding names its node once and references an existing page with a rect inside it, every page lists one level file per level and has a level at the mip limit, and the baked lamps are listed (possibly empty), each once.

#### Scenario: Broken reference refused
- **WHEN** a binding names a page that does not exist, or its rect leaves the page
- **THEN** the sidecar is refused, naming the binding

#### Scenario: Missing lamp list refused
- **WHEN** a sidecar has no `lamps` field
- **THEN** it is refused, so a bake never silently counts its lamps as live

### Requirement: Shell identity

The player SHALL apply a light bake only to the shell it was made for: the fetched shell GLB's SHA-256 SHALL equal the sidecar's `shellHash`, and every binding SHALL resolve to exactly one mesh, by its name in the shell file, whose UV1 is finite, two-component and lies inside the binding's rect. A sidecar for an apartment SHALL also carry `shellInputsHash` (requirement «Revision check before pages» of the light-bake shell). Any failure SHALL discard the whole bake, never apply part of it.

#### Scenario: Wrong shell
- **WHEN** the shell bytes do not hash to `shellHash`
- **THEN** the bake is refused before any texture is uploaded

#### Scenario: Missing or ambiguous mesh
- **WHEN** a binding names no mesh, or more than one object carries that name
- **THEN** the bake is refused, naming the node, and no material is changed

#### Scenario: Binding a mesh the bake gave no UV1
- **WHEN** a binding names an adopted mesh that has no UV1 (the site slab)
- **THEN** the bake is refused and no material is changed

#### Scenario: Digest grammar
- **WHEN** a sidecar's `shellInputsHash` is not `sha256:` followed by 64 lowercase hex digits
- **THEN** the sidecar is refused, naming the field

### Requirement: Atlas page upload

Each atlas page SHALL be one texture uploaded once per renderer context, read from UV channel 1, in no colour space, with `flipY` false, straight alpha and no colour-space conversion during decoding, carrying exactly the prepared levels 0 to the mip limit (each of the size its level implies) and no generated mipmaps. The decoded images SHALL stay available until the bake is disposed, so a restored context can upload them again.

#### Scenario: Uploaded bytes equal the file bytes
- **WHEN** every loaded level of the calibration page is read back texel by texel from the GPU
- **THEN** each byte equals the independently decoded RGBA of the lossless WebP file, small M values included

#### Scenario: Mip limit
- **WHEN** the calibration page is loaded with mip limit 3
- **THEN** the texture holds exactly four levels, 512, 256, 128 and 64 texels wide

### Requirement: RGBM decode in the material

A bound material SHALL decode its lightmap texel as `rgb × M × range` before multiplying by the lightmap intensity, in the standard and physical shading paths.

#### Scenario: Known texel
- **WHEN** a 1 × 1 lightmap with bytes (128, 64, 255, 96) and range 8 lights a zero-specular white material with intensity π
- **THEN** the rendered linear value equals the RGBM decode of those bytes within 0.5 %, and is far from what an sRGB-decoded texture would give

### Requirement: Hook composition

A bound material SHALL keep every shader hook and program key it had before binding: the decode is added through the lighting's `addShaderTransform` seam (never by assigning the hooks), runs after every earlier transform, and extends, never replaces, the existing program key. The decode SHALL hold whether a preserved hook expands the lighting chunks before or after it. A hook installed later that overwrites the decorated hook is outside this guarantee until the lighting composes its own hook.

#### Scenario: Two transforms
- **WHEN** two transforms are added to one material through `addShaderTransform`
- **THEN** both apply, in the order they were added, and the program key contains both `id@version`

#### Scenario: Chunks already expanded
- **WHEN** a transform added earlier has expanded the lightmap pars and maps chunks
- **THEN** the decode anchors on the expanded declaration and still holds

#### Scenario: Composed with another patch
- **WHEN** a material already has an `onBeforeCompile` and a program key, or a composed patch expanding the lighting chunks runs before or after the decode
- **THEN** both patches take effect and the program key contains both parts

#### Scenario: No anchor
- **WHEN** a material's existing hook, run on the prepared clone in its final state, removes the lightmap pars, or throws
- **THEN** binding refuses before any material or lamp flag changes, and the prepared clones are disposed

#### Scenario: Walk lighting installed after binding
- **WHEN** the walk lighting patch is installed on a bound material
- **THEN** the decode still holds; this scenario is pending until the lighting composes its hook

### Requirement: Binding transaction

Binding a bake SHALL clone each source material once per page it is bound on, give the clone the lightmap, the intensity and the decode, mark it with `markBakedSurface`, and assign it to the bound meshes, independently of mesh transforms. `unbind()` SHALL restore every mesh that still holds its clone and every lamp's previous flag, dispose the clones, and do nothing the second time.

#### Scenario: Non-identity transforms
- **WHEN** a lightmapped mesh's vertices are re-centred and the offset is moved into the mesh and parent transforms, leaving world geometry unchanged
- **THEN** the rendered result is unchanged

#### Scenario: Undo
- **WHEN** a bound shell is unbound
- **THEN** every mesh has its original material, no material is marked as a baked surface, and every lamp has its previous flag

### Requirement: Bound materials

Only standard and physical materials, one per mesh, SHALL be bound; a bound mesh without a valid two-component `uv1` SHALL refuse the bake. Every bound material SHALL be cloned, so a material the shell shares with furniture is never marked, and the clone SHALL carry no AO map.

#### Scenario: The bound clone itself is marked
- **WHEN** a source material already carries the baked-surface flag (a clone copies `userData`, not the lighting's per-material hooks)
- **THEN** `markBakedSurface` is called on each clone the binding assigns, and never relied on as inherited

#### Scenario: Material shared with furniture
- **WHEN** a shell mesh and a furniture mesh share one material and the shell mesh is bound
- **THEN** the furniture mesh keeps the unmarked original

### Requirement: Transmissive materials stay live

A bound mesh whose material transmits light (physical `transmission` above 0) SHALL be left with its own material, unbound and unmarked, and SHALL be named in the binding's result.

#### Scenario: Glass in the shell
- **WHEN** a bound mesh has a transmissive material
- **THEN** it keeps that material, no lightmap and no baked-surface mark, and its node is listed as transmissive

#### Scenario: No AO map on a baked surface
- **WHEN** a bound mesh's material has an AO map
- **THEN** its clone has none, and the source keeps its own

### Requirement: Page ownership

The pages SHALL belong to the loaded bake: its `dispose()` releases every texture and decoded image once, and a load that fails part-way releases what it had already decoded.

#### Scenario: Failed level
- **WHEN** one level file of a page cannot be fetched or has the wrong size
- **THEN** the load fails and every image decoded for it is closed

### Requirement: Unbaked projects unchanged

Nothing of the light bake SHALL run for a project without one: no request, no material change, no shader change, no lamp flag.

#### Scenario: Existing pictures
- **WHEN** the existing end-to-end screenshot suite runs
- **THEN** every baseline matches as before

### Requirement: Baked lamps

Every `PointLight` and `SpotLight` under a placement listed in the bake's `lamps` (the nearest `userData.assetId` on the way up) SHALL be marked baked with `setLampBaked`; a listed lamp id that resolves to no light SHALL be reported; an unlisted light SHALL stay live. Only this binding SHALL call `setLampBaked(light, true)`; lamp builders leave lights unflagged.

#### Scenario: Calibration lamp
- **WHEN** the calibration bake is bound onto a scene whose corner lamp sits in a placement group carrying the listed id
- **THEN** that lamp is marked baked and no lamp id is reported unresolved

### Requirement: Calibration of the intensity

On the calibration scene's sky-only plate, lit only by its lightmap through a zero-specular material, the irradiance read back as `pixel × π / albedo` SHALL be within 3 % of π × the sky radiance. The lightmap holds irradiance over π without albedo, decoded before the one application of the intensity. The intensity is calibrated in the editing look; scaling it in walk and tour by the interior factor is the lighting's.

#### Scenario: Plate
- **WHEN** the plate is rendered into a linear float target with the sun off and no other light
- **THEN** the measured irradiance is within 3 % of π

### Requirement: Calibration of the colour space

No sRGB conversion SHALL be applied to a lightmap at any stage: decoding the image, uploading it, or sampling it.

#### Scenario: Plate and known texel agree
- **WHEN** the plate scenario and the known-texel scenario pass
- **THEN** an sRGB decode anywhere would have moved them by far more than their tolerance, so neither applies one

### Requirement: Calibration of the orientation

The calibration lamp's landmark on the floor (the centre of the floor texels at or above 90 % of the floor's peak, rendered from above) SHALL land within 0.15 m of the lamp's floor point, and a synthetic asymmetric atlas SHALL read back unflipped and untransposed.

#### Scenario: Lamp landmark
- **WHEN** the floor alone is rendered from above with the lightmap bound
- **THEN** the landmark is within 0.15 m of the point under the lamp

### Requirement: Calibration of the sun split

Inside the window's sun footprint (the window projected along the sun onto the floor, eroded by 0.15 m, outside the block's shadow) the live direct sun's contribution with the lightmap bound SHALL equal its contribution without the lightmap within 2 % (mean over the samples), and on the zero-specular material it SHALL match `albedo / π × strength × cosθ × colour` within 3 %; the lighting in this measurement is reduced to what the baked-surface policy keeps.

#### Scenario: Four renders
- **WHEN** the floor is rendered with the lightmap off and on, each with the sun off and on
- **THEN** (lightmap and sun) minus (lightmap only) equals (sun only) minus (neither) within 2 % inside the eroded footprint

### Requirement: Sun split diagnostics

That direct sun is absent from the atlas SHALL remain the bake's own check of its direct term; the calibration SHALL print, without gating, the footprint against a ring around it with the sun off and the chart-edge contamination per mip level.

#### Scenario: Diagnostics printed
- **WHEN** the calibration runs
- **THEN** both diagnostics are printed with their values

### Requirement: Full lighting rig

With the player's own lighting rig and the baked-surface marks, no contribution the bake already carries SHALL be added again.

#### Scenario: Full lighting rig
- **WHEN** the calibration shell is shown with the player's own lighting rig and the baked-surface marks
- **THEN** no contribution the bake already carries is added again; this scenario is pending until the lighting reads the marks
