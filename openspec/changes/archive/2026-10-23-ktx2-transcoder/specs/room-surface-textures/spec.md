## MODIFIED Requirements

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

Room surface images SHALL be drawn top row up, so an upright scan stands upright on a wall and a normal map reads with a positive scale. WebP maps SHALL be decoded top row up. KTX2 maps, stored with their first row at the top of the picture and not flippable at upload, SHALL be sampled with the vertical texture axis reversed and the normal map's vertical scale negated, so both formats draw the same picture the same way. Images decoded for room surfaces SHALL NOT be shared with glTF models, whose convention differs.

#### Scenario: Upright marker on a wall
- **WHEN** a fixture texture with a mark in its top row is drawn on a wall
- **THEN** the mark appears at the top of each tile

#### Scenario: Upright KTX2 marker on a wall
- **WHEN** a KTX2 fixture with a mark in its top row is drawn on a wall
- **THEN** the mark appears at the top of each tile, as with the WebP fixture

#### Scenario: KTX2 normal leaning up
- **WHEN** a KTX2 normal map leaning towards the top of the picture is drawn on a wall
- **THEN** the wall is lit brighter from above than from below

### Requirement: Decode checks

A texture SHALL be decoded without colour conversion or alpha premultiplication, and its decoded width and height SHALL equal its named size; a mismatch or a decode failure SHALL leave the surface flat with a warning.

#### Scenario: Wrong pixel size
- **WHEN** a file listed as 512 decodes to 500 by 512
- **THEN** it is not used and the surface stays flat

## ADDED Requirements

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
