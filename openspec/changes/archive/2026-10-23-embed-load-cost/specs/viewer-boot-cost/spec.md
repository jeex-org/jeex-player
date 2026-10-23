## Purpose

Defines how a viewer's boot spends WebGL contexts and main-thread time before its first frame: one WebGL context per viewer, and the shared procedural noise tiles drawn in short slices rather than inside the build's single task, with no change to what a booted viewer draws.

## ADDED Requirements

### Requirement: One WebGL context per viewer

Deciding whether the browser supports WebGL SHALL NOT create a context of its own: the probe SHALL take the context on the viewer's own canvas with the attributes the renderer requests, and the renderer SHALL run on that same context. The answer SHALL be decided once per page; later viewers and every Retry SHALL NOT probe again.

#### Scenario: The first viewer on a page

- **WHEN** the first viewer on a page boots
- **THEN** exactly one WebGL context is created for it, and its renderer's context attributes equal those a renderer gets on a fresh canvas

#### Scenario: Two viewers

- **WHEN** two viewers boot on one page
- **THEN** the page has created two WebGL contexts

### Requirement: WebGL 2 is the support threshold

The probe SHALL ask for WebGL 2 only. A browser that cannot give a WebGL 2 context SHALL get the viewer's "no WebGL" card and a `webgl-unavailable` error, before the scene is loaded.

#### Scenario: WebGL 1 only

- **WHEN** a browser offers WebGL 1 but not WebGL 2
- **THEN** the viewer shows the "no WebGL" card and reports `webgl-unavailable`

### Requirement: Noise tiles are drawn in slices while the scene loads

During the boot, while the scene document is loading, the viewer SHALL draw the procedural noise tiles that do not depend on a finish, in slices of at most about 8 ms that each give the main thread back, and SHALL await them before building the scene. A tile SHALL enter the shared texture cache only when complete; a dispose during the boot SHALL stop the slicing.

#### Scenario: Slices yield

- **WHEN** the tiles are drawn on a clock that is always past its slice deadline
- **THEN** the drawing yields before every step of rows and caches no tile before it is complete

#### Scenario: Disposed while slicing

- **WHEN** the viewer is disposed while a tile is being drawn
- **THEN** the slicing stops at its next yield and that tile is not cached

### Requirement: Prewarmed tiles do not change pixels

A tile drawn in slices SHALL have exactly the pixels of the same tile drawn on demand, and a texture painted after the prewarm SHALL use the cached tiles instead of drawing its own. A tile the prewarm did not draw SHALL be drawn on demand, as before.

#### Scenario: Same pixels

- **WHEN** every common tile is drawn in slices and again on demand
- **THEN** the two have identical pixels

#### Scenario: Painter reuses the cache

- **WHEN** a plank floor texture is painted after the prewarm
- **THEN** no common tile in the cache is replaced

#### Scenario: Booted viewers draw as before

- **WHEN** the e2e canvas and chrome baselines are compared after this change
- **THEN** none of them changes
