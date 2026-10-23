## ADDED Requirements

### Requirement: A detached canvas parks the render loop

While the viewer's canvas is not connected to a document, the viewer SHALL draw nothing and SHALL schedule no further animation frames for its render loop. Detaching SHALL NOT dispose the viewer, release its WebGL context or change its public API; `dispose()` remains the documented teardown.

#### Scenario: Host removes the viewer's container without dispose

- **WHEN** a host removes the element that contains a running viewer from the page and does not call `dispose()`
- **THEN** within one frame the viewer stops drawing, and no draw call happens while the element stays off the page

#### Scenario: A context restored while detached stays parked

- **WHEN** the WebGL context is lost and restored while the canvas is off the page
- **THEN** the viewer does not draw until the canvas is connected again

#### Scenario: A stopped or disposed viewer stays down

- **WHEN** a viewer that was stopped or disposed while detached is connected again
- **THEN** its render loop does not start

#### Scenario: No wake signal, no park

- **WHEN** the environment offers no way to observe the viewer's box (no `ResizeObserver`, or a viewport given without an element)
- **THEN** the loop keeps its previous behaviour and does not park

### Requirement: Reconnecting resumes the render loop

When the canvas of a parked viewer is connected to a document again, the viewer SHALL resume drawing without any call from the host, at its restored size, and the first frame step handed to frame hooks SHALL be the time since the resume, not the time spent detached.

#### Scenario: Host puts the same element back

- **WHEN** a host re-inserts the removed element into the page after a long absence
- **THEN** the viewer draws again, the drawing buffer is resized before the first resumed frame, and that frame's step is the time since the resume

#### Scenario: Started before it was on the page

- **WHEN** a viewer is started while its container is not yet in a document and the container is then attached
- **THEN** the viewer starts drawing

#### Scenario: Started while not visible

- **WHEN** a viewer was started while its canvas was hidden (for example `display: none`) and its box later becomes visible
- **THEN** the viewer starts drawing
