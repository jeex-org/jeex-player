## ADDED Requirements

### Requirement: Shaders compiled before the first picture

Before its first display draw the player SHALL compile the scene's programs asynchronously, using parallel compilation where the browser supports it, and SHALL make the first display draw when that compilation has resolved or 1 s has passed, whichever comes first; a rejection, a throw or a renderer without asynchronous compilation SHALL allow the draw at once. Frame hooks SHALL keep running meanwhile.

#### Scenario: First frame without a long link wait
- **WHEN** the demo apartment is loaded on a browser with parallel shader compilation
- **THEN** the self time of program-status queries (`getProgramParameter`, `getProgramInfoLog`) inside the task that makes the first display draw, from a CPU profile, median of 5, is at most a quarter of its value before this change

#### Scenario: Bounded wait
- **WHEN** compilation does not resolve within 1 s (a bound long enough for parallel linking of the demo apartment, short enough for a driver that never reports readiness)
- **THEN** the first display draw happens at 1 s

#### Scenario: No asynchronous compilation
- **WHEN** compilation rejects, throws, or the renderer has no asynchronous compilation
- **THEN** the first display draw happens at once

#### Scenario: Without parallel compilation
- **WHEN** parallel shader compilation is unavailable (forced by reporting the extension as missing)
- **THEN** the first picture appears as before, no later than before plus one frame

### Requirement: Compilation at other entry points

The player SHALL compile asynchronously, with the chain's scene target bound, the scene's programs for the walk and tour chain before the chain attaches (drawing directly until then), and the scene's programs again after a GPU context restore before the next display draw, within the same bound.

#### Scenario: Chain attach
- **WHEN** the walk chain attaches
- **THEN** its first frame through the chain does not link its programs synchronously

#### Scenario: Start in tour
- **WHEN** the viewer starts in tour and the chain attaches after the first direct frames
- **THEN** the scene's programs are not re-linked synchronously on the first frame through the chain

#### Scenario: Context restore
- **WHEN** the GPU context is restored
- **THEN** the next picture appears after asynchronous compilation, within the bound

### Requirement: Ready after the first picture

The viewer's `ready` event, its app-ready flag and the reveal of the viewer SHALL come after the first display draw, also after a GPU context restore.

#### Scenario: No blank canvas at ready
- **WHEN** a host waits for `ready` and takes a screenshot
- **THEN** the screenshot shows the drawn scene, not a blank canvas
