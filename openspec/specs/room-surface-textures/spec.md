# room-surface-textures Specification

## Purpose
Defines how the viewer draws library materials on room surfaces (floors, walls, ceilings, facades and trim): where texture bytes come from and how much may be fetched, which size is drawn, and how colour, tint, UVs and maps are applied, released and restored.

## Requirements

### Requirement: Library materials draw on room surfaces

A room surface whose resolved finish is a library material SHALL draw it with its maps and PBR facts; bundled finishes, generators, `pbr` members and `Room.floorMaterial` SHALL draw as before.

#### Scenario: Scan on a floor
- **WHEN** a room's floor resolves to a scan library material and its maps have loaded
- **THEN** the floor shows the scan's colour map at its tile size

#### Scenario: Legacy finish unchanged
- **WHEN** a document uses only bundled finishes
- **THEN** its rendering is unchanged by this capability

### Requirement: Flat first frame

The first frame after a mount or repaint SHALL draw every library surface in a flat colour without waiting for any texture: `averageColour` for a natural material, `averageColour` times the tint times the tint recipe's gain in linear light for a tintable scan, and the tint itself for a tintable parameters material, which has no map. Texture work SHALL start only after that frame.

#### Scenario: Delayed texture response
- **WHEN** a project is mounted while its texture responses are held back
- **THEN** the viewer reports ready and every library surface shows its flat colour

#### Scenario: Tintable paint first frame
- **WHEN** a tintable parameters material with `pbr.baseColour: '#806040'` is drawn with `colour: '#2050a0'`
- **THEN** its colour is `#2050a0` from the first frame on and never `#806040` or a product of the two

#### Scenario: Map arrives
- **WHEN** the colour map of a natural material finishes loading
- **THEN** the material colour becomes white so the map is drawn as is, and the surface shows the map

### Requirement: Tint

A tintable material SHALL use the finish value's `colour`, or else its first suggested colour, as the tint. A tintable scan SHALL draw `albedoTint` times the tint times the gain of its tint recipe, in linear light. The gain undoes the recipe's normalisation (for `luma-mid@1`, the inverse of mid grey in linear light); a tintable parameters material SHALL draw the tint as its base colour. A natural material SHALL ignore any `colour`.

#### Scenario: Tinted scan
- **WHEN** a tintable scan is drawn with `colour: '#ff0000'` over a mid-grey `albedoTint`
- **THEN** the rendered surface is red with the map's variation and no green or blue beyond the light's contribution

#### Scenario: Natural tint reproduces the scan
- **WHEN** a `luma-mid@1` scan whose natural colour is `#9a8d7a` is drawn with `colour: '#9a8d7a'`, before and after its mid-grey `albedoTint` arrives
- **THEN** the map's mean times the colour factor equals `#9a8d7a` within half an 8-bit step, and the flat first frame (from the `#808080` average) within one step

#### Scenario: Paint without colour
- **WHEN** a tintable parameters material is drawn from a bare UUID
- **THEN** its base colour is its first suggested colour

#### Scenario: Colour on a natural material
- **WHEN** a natural scan is drawn with a `colour`
- **THEN** it renders the same as without it

### Requirement: PBR facts applied

The drawn material SHALL apply the PBR facts by glTF rules, defaulting metalness to 0, roughness to 1 and alpha mode to `opaque`; a scalar multiplies its map, a scan's `baseColour` multiplies its colour map, and `mask` cuts at 0.5.

#### Scenario: Absent metalness
- **WHEN** a scan with `arm` and no `pbr.metalness` is drawn
- **THEN** it renders non-metallic whatever the ARM blue channel holds

#### Scenario: Metalness one
- **WHEN** a scan with `pbr.metalness: 1` is drawn
- **THEN** the ARM blue channel decides the metalness per texel

#### Scenario: Physical fields promote the material
- **WHEN** a material carries any of sheen, sheenColour, sheenRoughness, clearcoat, clearcoatRoughness, transmission, ior, thicknessM, attenuationDistanceM or attenuationColour
- **THEN** it is drawn with the physical material model so the field takes effect

#### Scenario: IOR only
- **WHEN** a material carries only `ior: 1.5` among the physical fields
- **THEN** it is drawn with the physical material model and its index of refraction is 1.5

#### Scenario: Mask cutoff
- **WHEN** a material with `alphaMode: 'mask'` is drawn over a map whose alpha is 0.4 in one half and 0.6 in the other
- **THEN** the first half is cut away and the second is opaque

### Requirement: Map wiring

Colour maps SHALL be sampled as sRGB and every other map as non-colour data. One ARM image SHALL feed ambient occlusion (red), roughness (green) and metalness (blue). Normal maps SHALL be read as OpenGL tangent-space normals with a scale of `normalStrength` (default 1). Ambient occlusion SHALL read the surface's primary UV set.

#### Scenario: Normal direction under a known light
- **WHEN** a flat fixture with a normal map tilted towards +U is lit from +U
- **THEN** the lit side is brighter than the same fixture lit from -U

#### Scenario: ARM channels
- **WHEN** a fixture's ARM map has AO 1, roughness 0.2 and metal 0 in one half and roughness 1 in the other
- **THEN** the first half shows a sharper highlight than the second

### Requirement: Sampling

Room surface textures SHALL repeat, use linear magnification, and use anisotropy of the smaller of 8 and the hardware maximum. A WebP map SHALL generate mipmaps and use trilinear minification. A KTX2 map SHALL use the mip levels its file supplies, generate none, and use trilinear minification when it has more than one level and linear minification when it has one. Every allowed size, including 384 and 768, SHALL be drawn.

#### Scenario: Grazing floor
- **WHEN** a textured floor is viewed at a grazing angle
- **THEN** its texture uses mipmaps and the bounded anisotropy

#### Scenario: KTX2 with a full mip chain
- **WHEN** a KTX2 map with all of its mip levels is drawn
- **THEN** it uses the file's levels with trilinear minification and no mipmaps are generated

#### Scenario: KTX2 with one level
- **WHEN** a KTX2 map with a single level is drawn
- **THEN** it is drawn with linear minification

### Requirement: Image orientation

Room surface images SHALL be drawn top row up, so an upright scan stands upright on a wall and a normal map reads with a positive scale. WebP maps SHALL be decoded top row up. KTX2 maps, which cannot be flipped at upload, SHALL be sampled with the vertical texture axis reversed and the normal map's vertical scale negated, so both formats draw the same picture the same way. Images decoded for room surfaces SHALL NOT be shared with glTF models, whose convention differs.

#### Scenario: Upright marker on a wall
- **WHEN** a fixture texture with a mark in its top row is drawn on a wall
- **THEN** the mark appears at the top of each tile

#### Scenario: Upright KTX2 marker on a wall
- **WHEN** a KTX2 fixture with a mark in its top row is drawn on a wall
- **THEN** the mark appears at the top of each tile, as with the WebP fixture

#### Scenario: KTX2 normal leaning up
- **WHEN** a KTX2 normal map leaning towards the top of the picture is drawn on a wall
- **THEN** the wall is lit brighter from above than from below

### Requirement: Tile scale and rotation

Texture coordinates on room surfaces SHALL be metres divided by `tileM` per axis, after rotating the metre coordinates by the automatic grain angle plus the finish value's `rotation` (degrees, counter-clockwise). Every map of one material SHALL use the same transform.

#### Scenario: Tile size
- **WHEN** a scan with `tileM: [2, 1]` is drawn on a wall 4 m long
- **THEN** exactly two tiles repeat along its length and one per metre of height

#### Scenario: Rotation
- **WHEN** the same finish carries `rotation: 90`
- **THEN** the tiles are turned a quarter counter-clockwise and the tile size still holds

### Requirement: Floor grain

On a floor, a material with `grain` `along_u` or `along_v` SHALL turn that texture axis along the room's longest outline edge; `none` and `unknown` SHALL NOT be turned. A tie between edges SHALL be broken deterministically.

#### Scenario: Planks along the long side
- **WHEN** a plank scan with `grain: 'along_u'` is drawn in a room 6 m by 3 m
- **THEN** the planks run along the 6 m side

#### Scenario: Isotropic scan
- **WHEN** a scan with `grain: 'none'` is drawn in the same room
- **THEN** it is not turned

### Requirement: Metre UVs on every room surface

Walls, floors, ceilings, facades, trim and wall reveals SHALL carry texture coordinates in metres, continuous along a wall face; a reveal SHALL get its own metre coordinates instead of reusing the front plane's.

#### Scenario: Baseboard tile size
- **WHEN** a trim material with `tileM: [1, 1]` is drawn on a 3 m baseboard
- **THEN** three tiles repeat along it

#### Scenario: Reveal not smeared
- **WHEN** a scan is drawn on a wall with a window
- **THEN** the reveal's texture has the same texel density as the front of the wall

### Requirement: Size by device class

The viewer SHALL choose the texture size by the GPU class, whether or not telemetry is enabled: 256 for low, 512 for mid, 768 for high. When the material does not list that size, the nearest listed size SHALL be used, and a tie SHALL go to the smaller one.

#### Scenario: Mid device, sizes 384 and 768
- **WHEN** a mid device draws a material that lists only 384 and 768
- **THEN** it loads 384

#### Scenario: Telemetry off
- **WHEN** telemetry is disabled on a high device
- **THEN** the viewer still loads 768

### Requirement: Texture location

A texture path SHALL resolve against the manifest folder, unless the host supplied a texture resolver (`resolveTexture`), which SHALL then be called with the logical path each time a texture of a size is fetched and SHALL return the URL to fetch, an absolute `http(s)` or a `blob:` URL; any other result SHALL leave that surface flat with a warning. A resolver failure SHALL leave that surface flat.

#### Scenario: Baked project
- **WHEN** a baked project at `https://example.test/p/` draws `tex/<v>/albedo.512.webp`
- **THEN** the viewer fetches `https://example.test/p/tex/<v>/albedo.512.webp`

#### Scenario: Live resolver called lazily
- **WHEN** a host supplies a resolver and a surface needs size 512 of one map
- **THEN** the resolver is called once with that logical path, at fetch time, and never for unused sizes

#### Scenario: Resolver throws
- **WHEN** the resolver throws or rejects for a path
- **THEN** that surface keeps its flat colour, the viewer logs a warning and the other surfaces still load

#### Scenario: Resolver URL kinds
- **WHEN** the resolver returns a `blob:` URL, then for another path a relative path, and for a third a `data:` URL
- **THEN** the `blob:` map is fetched and drawn, and the other two surfaces keep their flat colour with a warning each

### Requirement: Resolver option is a host object

The texture resolver SHALL be a host object option: not readable from a query string or an HTML attribute, copied through verbatim and absent from the published viewer options JSON schema.

#### Scenario: Attribute ignored
- **WHEN** an element carries a `resolve-texture` attribute
- **THEN** no resolver is installed

### Requirement: Texture job deadline

Each texture job SHALL finish within `TEXTURE_FETCH_DEADLINE_MS` (30 000 ms, exported by the shared limits module), counted from the start of resolver resolution to the last byte read. On expiry the job SHALL be aborted and free its concurrency slot, the surface SHALL stay flat and a warning SHALL be logged.

#### Scenario: Stalled resolver
- **WHEN** the host resolver returns a promise that never settles
- **THEN** after the deadline the job is abandoned, the surface stays flat, a warning is logged and the next queued texture starts

#### Scenario: Stalled stream
- **WHEN** a texture response sends headers and then stops sending bytes
- **THEN** after the deadline the read is aborted, the surface stays flat and a warning is logged

### Requirement: Per-file byte cap

A texture fetch SHALL count the bytes it reads, without trusting `Content-Length`, and SHALL be cancelled once a file passes `MAX_TEXTURE_FILE_BYTES` (2 MiB); that surface SHALL stay flat.

#### Scenario: Oversized file
- **WHEN** a texture response streams 3 MiB with no `Content-Length`
- **THEN** the fetch is cancelled after 2 MiB, the surface stays flat and a warning is logged

### Requirement: Document texture budget

The viewer SHALL count the texture bytes actually fetched over a document's lifetime, cache hits excluded and concurrent fetches included. Once the count reaches `MAX_PROJECT_TEXTURE_BYTES` (48 MiB), queued and active texture work SHALL stop and unloaded surfaces SHALL keep their flat colours.

#### Scenario: Budget reached
- **WHEN** a document's texture fetches reach 48 MiB
- **THEN** no further texture is fetched for that document, active fetches are cancelled — the fetch whose bytes reached the limit included, so that file's surface stays flat too — and a warning names the limit

#### Scenario: New document
- **WHEN** another document is loaded
- **THEN** its count starts at zero

### Requirement: Decode checks

A texture SHALL be decoded without colour conversion or alpha premultiplication; its decoded longer side SHALL equal its named size and its shorter side SHALL be that size divided by a power of two (1, 2, 4 and so on), the map of a rectangular tile; a mismatch or a decode failure SHALL leave the surface flat with a warning.

#### Scenario: Wrong pixel size
- **WHEN** a file listed as 512 decodes to 500 by 512
- **THEN** it is not used and the surface stays flat

#### Scenario: Rectangular tile
- **WHEN** a file listed as 256 of a material whose tile is 3.6 by 1.8 m decodes to 256 by 128
- **THEN** it is drawn, one image per tile

### Requirement: Shared images and release

One decoded image per version, role and size SHALL serve every surface that draws it, concurrent requests sharing one fetch. An image SHALL be released after its last user is gone, and repainting a surface SHALL never release an image another surface still draws.

#### Scenario: Repaint one of two rooms
- **WHEN** two rooms wear the same scan and one is repainted with another finish
- **THEN** the other room still draws the scan and no second fetch happens

#### Scenario: Unmount
- **WHEN** the document is unmounted
- **THEN** every texture and image it created is released

### Requirement: Late completion is ignored

A texture that completes after its surface was repainted, its document replaced or the viewer disposed SHALL NOT be applied, and SHALL be released if nothing else uses it.

#### Scenario: Repaint during a fetch
- **WHEN** a surface is repainted while its previous material's texture is still loading
- **THEN** the late texture never appears on that surface

### Requirement: Context restore keeps the document

After a lost rendering context is restored, the viewer SHALL remount the same document with the same project options (models, materials, catalogue, variants) and rebuild textures from the bytes it kept, without fetching them again.

#### Scenario: Restore a project
- **WHEN** the context of a mounted project is lost and restored
- **THEN** its project objects and library surfaces render as before the loss and no texture is fetched again

### Requirement: No texture loading without a context

Without a WebGL context the viewer SHALL fetch no texture.

#### Scenario: No context
- **WHEN** the viewer runs with its flat fallback
- **THEN** no texture request is made

### Requirement: KTX2 container checks

Before a KTX2 map is transcoded, its container SHALL be a single 2D image with one layer and one face, a Basis Universal payload (ETC1S or UASTC), the named square size, and the default orientation when an orientation is stated; otherwise the surface stays flat with a warning and nothing is transcoded.

#### Scenario: Wrong size in the container
- **WHEN** a file listed as `256` holds a 128 by 128 KTX2
- **THEN** it is not transcoded and the surface stays flat with a warning

#### Scenario: Not a Basis payload
- **WHEN** a `.ktx2` file holds an uncompressed or a non-Basis block format
- **THEN** it is not used and the surface stays flat with a warning

### Requirement: KTX2 colour space by role

A KTX2 map SHALL be drawn in the colour space of its role, as a WebP map is; when the container's transfer function disagrees with the role, the map SHALL still be drawn by its role and the viewer SHALL warn.

#### Scenario: Linear normal map stored as sRGB
- **WHEN** a normal map's KTX2 container says sRGB
- **THEN** the map is drawn as linear data and a warning names the file

### Requirement: KTX2 maps share one decoded image

KTX2 maps SHALL follow the same sharing, release and restore rules as WebP maps: one transcoded image per version, role and size, the encoded bytes kept for the document, and the transcoder handed a copy so the kept bytes stay usable.

#### Scenario: Two rooms, one KTX2 scan
- **WHEN** two rooms wear the same KTX2 scan
- **THEN** each file is fetched and transcoded once

#### Scenario: Context restore
- **WHEN** the WebGL context is restored after a loss
- **THEN** the KTX2 maps are drawn again without a second fetch

### Requirement: Sheen lobe

A material that states sheen facts SHALL draw them as the physical material's `sheen`, `sheenRoughness` and `sheenColor`. A stated `sheenColour` SHALL be taken in linear light like every library colour. A stated `sheen` without `sheenColour` SHALL take the draw's tint (the finish colour, else the first suggested colour) lerped toward white in linear light by the fixed sheen lift of 0.2, or white when the material has no tint. An absent `sheenRoughness` SHALL leave three's default of 1.

#### Scenario: Stated sheen facts
- **WHEN** a cloth material states `sheen: 0.3`, `sheenRoughness: 0.6` and `sheenColour: '#d0c8b8'`
- **THEN** its physical material has sheen 0.3, sheen roughness 0.6 and the linear sheen colour of `#d0c8b8`

#### Scenario: Tinted sheen without a colour
- **WHEN** a tintable scan with recipe `luma-mid@1`, drawn in `#5a6b8c`, states `sheen: 0.3` and no `sheenColour`
- **THEN** its sheen colour is the linear colour of `#5a6b8c` lerped toward white by 0.2, without the recipe's map gain

#### Scenario: Suggested colour as the tint
- **WHEN** such a scan is drawn with no finish colour
- **THEN** its sheen colour is the linear colour of its first suggested colour lerped toward white by 0.2

#### Scenario: Untinted sheen without a colour
- **WHEN** a natural material states `sheen: 0.3` and no `sheenColour`
- **THEN** its sheen colour is white

#### Scenario: Sheen roughness alone
- **WHEN** a material carries only `sheenRoughness: 0.6` among the physical fields
- **THEN** it is drawn with the physical material model and its sheen roughness is 0.6
