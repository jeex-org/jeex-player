# compressed-textures Specification

## Purpose
Defines how the viewer decodes KTX2 (Basis Universal) textures: where the transcoder files are found from every embed shape, when they are fetched, how one transcoder serves a viewer, and how furniture GLBs that use `KHR_texture_basisu` load.

## Requirements

### Requirement: Transcoder files ship beside the bundles

Every build the package produces SHALL contain the transcoder as two files next to the player's own bundles, `lazy-jeex-viewer-basis-transcoder-<hash>.js` and `lazy-jeex-viewer-basis-transcoder-<hash>.wasm`, both named by one hash of both files' contents. No bundle SHALL inline either file.

#### Scenario: Library build
- **WHEN** the library build runs
- **THEN** `dist-lib/` holds both transcoder files at its root and no bundle contains the transcoder as a `data:` URL

#### Scenario: Demo build
- **WHEN** the demo build runs
- **THEN** `dist/assets/` holds both transcoder files beside the chunks

#### Scenario: Upgrade changes the bytes
- **WHEN** either transcoder file changes
- **THEN** both published names change

### Requirement: Transcoder location

The viewer SHALL fetch the transcoder files from the folder of the player file that is running: the module's own URL in the ES builds, the classic script's own URL in the IIFE build, read while it evaluates. The dev server SHALL answer both names on any path.

#### Scenario: Custom element from a CDN folder
- **WHEN** a page loads the element entry from `https://cdn.example/jeex/1.0.0/` and the scene uses KTX2
- **THEN** the transcoder files are fetched from `https://cdn.example/jeex/1.0.0/`

#### Scenario: IIFE
- **WHEN** a page loads `jeex-viewer.iife.js` with a classic script tag from a folder and the scene uses KTX2
- **THEN** the transcoder files are fetched from that folder

#### Scenario: iframe
- **WHEN** a host embeds the viewer's `embed.html` and the scene uses KTX2
- **THEN** the transcoder files are fetched from the folder `embed.html` and its module are served from

### Requirement: Transcoder loads only when needed

The transcoder files SHALL be fetched only when the viewer first meets a KTX2 asset and never for a document without KTX2. Once the transcoder has started, each file SHALL have been fetched exactly once for that viewer; a start that failed SHALL be tried again by the next KTX2 asset.

#### Scenario: WebP-only document
- **WHEN** a document whose GLBs and room maps are all WebP finishes loading
- **THEN** neither transcoder file was requested

#### Scenario: KTX2 furniture and room maps together
- **WHEN** a document with a `KHR_texture_basisu` GLB and `.ktx2` room maps finishes loading
- **THEN** each transcoder file was requested exactly once

#### Scenario: Failed start, then a later asset
- **WHEN** the first transcoder request fails and a later KTX2 asset is met after the files became reachable
- **THEN** the files are requested again, the later asset is drawn, and no further request follows

### Requirement: Formats detected on the drawing renderer

The transcoder SHALL target the compressed formats the viewer's own renderer reports, so the same file decodes to a format the device can sample.

#### Scenario: Device support
- **WHEN** a KTX2 texture is decoded
- **THEN** the format it is uploaded in is one the viewer's renderer supports

### Requirement: GLBs with KHR_texture_basisu

A GLB that lists `KHR_texture_basisu` SHALL load with its KTX2 textures; a GLB that does not list it SHALL load without touching the transcoder.

#### Scenario: Baked basisu variant
- **WHEN** a placement's model is a GLB whose base colour texture uses `KHR_texture_basisu`
- **THEN** its GLB body replaces the procedural body and draws its texture

### Requirement: Transcoder failure keeps the procedural body

When the transcoder cannot be fetched, or reports an error for any of a GLB's KTX2 textures, that GLB SHALL be refused as a model load failure with the reason `ktx2-transcoder`, so its procedural body stays; it SHALL NOT appear untextured. A transcoder that never answers leaves the procedural body in place without a report.

#### Scenario: Transcoder missing
- **WHEN** the transcoder files answer 404 and a placement's GLB uses `KHR_texture_basisu`
- **THEN** the placement keeps its procedural body and the failure is reported once for the model

#### Scenario: Transcoding fails inside the parse
- **WHEN** the transcoder starts but reports an error for one KTX2 texture of a GLB
- **THEN** the GLB is discarded with its resources freed and the placement keeps its procedural body

### Requirement: Disposed sources free their textures

When a model source is disposed, it SHALL free the geometries, materials and textures of every model it parsed.

#### Scenario: Unmount after a textured GLB
- **WHEN** a document with a textured GLB is unmounted
- **THEN** every texture the GLB brought is disposed
