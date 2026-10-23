# embed-element-start Specification

## Purpose
Defines when the `<jeex-viewer>` custom element starts its viewer, what a page downloads and shows before that, and how the element's handle behaves before the start, so that a pasted player costs a page nothing until it is about to be seen.

## Requirements

### Requirement: The element starts its viewer near the viewport

A connected `<jeex-viewer>` with `loading` lazy (the default) SHALL start its viewer when the element comes within 100 px above or below the viewport, or on the first `pointerdown` or `focusin` that reaches it, whichever comes first. Before the start it SHALL NOT load the viewer's code, create a WebGL context, draw textures or fetch the scene. A browser without `IntersectionObserver` SHALL start at once.

#### Scenario: A below-the-fold element waits

- **WHEN** a page connects an element 2400 px below the top of a 720 px viewport and stays idle
- **THEN** the page has fetched only the element bundle's static files, has created no WebGL context, and the element has no viewer inside it

#### Scenario: Scrolling near starts it

- **WHEN** the page scrolls the element into view
- **THEN** the viewer's code is fetched, one WebGL context is created and the element reaches `:state(ready)`

#### Scenario: A press starts it without a scroll

- **WHEN** a `pointerdown` reaches an element that has not started
- **THEN** the viewer starts and the handle's `ready` resolves

#### Scenario: An element on screen starts on the first layout

- **WHEN** an element is connected inside the viewport
- **THEN** it starts without any interaction

### Requirement: The `loading` attribute chooses lazy or eager

The element SHALL take a `loading` attribute spelled like the one on `img` and `iframe`. `lazy`, the default, SHALL start the viewer near the viewport as above. `eager` SHALL start it at connect. A missing, empty or unknown value SHALL mean `lazy`, and `eager` SHALL match regardless of case. A reflected `loading` property SHALL read `'lazy'` or `'eager'` and set the attribute. Changing the value to `eager` before the start SHALL start the viewer; changing it after the start SHALL change nothing.

#### Scenario: An eager element below the fold starts at load

- **WHEN** a page connects `<jeex-viewer loading="eager">` 2400 px below the top of the viewport and stays idle
- **THEN** the viewer starts without a scroll and the element reaches `:state(ready)`

#### Scenario: An unknown value is lazy

- **WHEN** an element carries `loading="soon"`
- **THEN** its `loading` property reads `'lazy'` and it waits for the viewport

#### Scenario: Switching to eager before the start

- **WHEN** a host sets `element.loading = 'eager'` on an element still waiting for the viewport
- **THEN** the attribute reads `eager` and the viewer starts

### Requirement: The box is the player's final size before the start

From `connectedCallback` on, a shadow-mode element SHALL hold its default box (block, full width, the `ratio` of it, every page rule winning) and SHALL show `:state(loading)`; the start SHALL fill that box without changing its size. `ratio` SHALL stay live before the start.

#### Scenario: No layout shift from the start

- **WHEN** a below-the-fold element starts after a scroll
- **THEN** its box has the same width and height as before the start, and the page's layout shift is no larger than that of an element that started at once

#### Scenario: Ratio before the start

- **WHEN** a page changes `ratio` on an element that has not started
- **THEN** the box takes the new ratio at once

### Requirement: The element's handle exists from the connect on

From `connectedCallback` until `disconnectedCallback`, `viewer` and `tour` SHALL be a handle, whether or not the viewer has started; outside that span they SHALL be `null`. One handle object SHALL serve the whole connection and SHALL forward to the running viewer once it exists.

#### Scenario: Right after append

- **WHEN** a script appends an element and reads `viewer` in the same task
- **THEN** it gets a handle whose `ready` is a promise

#### Scenario: Same object before and after the start

- **WHEN** a host keeps `viewer` from before the start and calls it after `ready`
- **THEN** the calls drive the running viewer

### Requirement: Commands before the start are replayed after the boot

Until the started viewer first reports `ready`, every handle and tour command that returns nothing, `loadScene` and `slots.anchorTo` SHALL be queued and SHALL be applied in call order at that report, before the element fires `jeex-ready`. A boot that fails SHALL apply none of them; they wait for a Retry that reaches `ready`. A queued `loadScene` SHALL settle with the replayed call, or reject with the reason the viewer will not start. No call SHALL start the viewer.

#### Scenario: A mode set before the start sticks

- **WHEN** a host calls `setMode('plan2d')` before the start and the element is then scrolled into view
- **THEN** after `ready` the viewer is in `plan2d`

#### Scenario: A queued load when the element leaves first

- **WHEN** a host calls `loadScene` before the start and the element is removed before it started
- **THEN** that promise rejects with code `disposed`

#### Scenario: A queued load when the host disposes during the boot

- **WHEN** a host calls `loadScene` while the started viewer is still booting and then calls `viewer.dispose()`
- **THEN** the viewer is disposed and that promise rejects with code `disposed`

#### Scenario: A failed boot replays nothing

- **WHEN** a host queues `setMode('walk')` and `loadScene(...)` before the start and the first boot fails
- **THEN** neither is applied, and both are applied when a Retry boots and reports `ready`

#### Scenario: Calls keep their order

- **WHEN** a host calls `setMode('walk')` and then `setMode('orbit')` before the start
- **THEN** both are applied after the boot, in that order

### Requirement: The running viewer answers from its first scene

From the started viewer's first `scene` event on, queries, boolean commands, captures and exports SHALL be answered by the running viewer, so a host's `jeex-scene` and `jeex-ready` listeners see its document.

#### Scenario: Inside the first jeex-ready

- **WHEN** a host that called `setMode('plan2d')` before the start reads the handle inside its first `jeex-ready` listener
- **THEN** `getMode()` answers `plan2d` and `getScene()` a document

### Requirement: Queries before the start answer as before a first scene

Before the started viewer's first `scene` event, `getMode`, `getLocale` and `getFurnitureVisible` SHALL answer the last queued setter's value, else the value the options resolve to; `options` SHALL be the resolved options; `getScene`, `project`, `describeSelection`, `tour.progress` and `slots.anchorPoint` SHALL answer `null`; every command that answers whether it did anything SHALL answer `false`; `getState` SHALL answer these values with no scene, revision 0 and no tour.

#### Scenario: Mode from the attribute

- **WHEN** an element with `view="plan2d"` has not started
- **THEN** `viewer.getMode()` answers `plan2d` and `viewer.getScene()` answers `null`

### Requirement: Results that need a frame reject before the start

Before the started viewer's first `scene` event, `capture.still`, `capture.panorama`, `capture.pair`, `capture.frames`, `exportGlb` and `exportUsdz` SHALL reject with code `not-ready`, `slots.get` SHALL throw a `not-ready` error, and `element` SHALL be the box the viewer will be built in. These two differ from a mounted handle, whose slot nodes and root exist before its first scene; they are the documented exceptions of the deferred start.

#### Scenario: An export before the start

- **WHEN** a host calls `viewer.exportGlb()` on an element that has not started
- **THEN** the promise rejects with code `not-ready`

### Requirement: Subscriptions and ready carry over the start

`on(...)` and `tour.on(...)` made before the start SHALL receive the started viewer's events, and their unsubscribe functions SHALL work before and after the start. `ready` SHALL be one promise for the connection: it SHALL settle with the started viewer's `ready`, and SHALL reject with code `disposed` when the element is disconnected, or the handle disposed, before the start.

#### Scenario: A listener from before the start

- **WHEN** a host subscribes to `mode` before the start and the viewer later switches mode
- **THEN** the listener is called with the new mode

#### Scenario: Disconnected before the start

- **WHEN** an element is removed before it started
- **THEN** its `ready` rejects with code `disposed`, no viewer is built later, and `viewer` is `null`

### Requirement: Attributes changed before the start are read at the start

An attribute other than `ratio` changed before the start SHALL take effect at the start as if it had been set before the connect, with no `attribute-read-once` warning. After the start the existing liveness rules apply unchanged.

#### Scenario: View changed before the start

- **WHEN** a page sets `view="walk"` on an element that has not started and then scrolls it into view
- **THEN** the viewer is built in `walk`

### Requirement: A failed load of the viewer's code is reported by the element

When the viewer's code cannot be loaded at the start, the element SHALL fire `jeex-error` with code `internal`, SHALL enter `:state(error)`, SHALL log the failure through its sink, and `ready` SHALL reject with code `internal`. A later reconnect SHALL try again.

#### Scenario: Network failure at the start

- **WHEN** the request for the viewer's code fails
- **THEN** the element fires `jeex-error` with code `internal` and shows `:state(error)`

### Requirement: The programmatic and framed forms start at once

`mountViewer(container, options)` SHALL build the viewer immediately, and the iframe page SHALL boot its viewer when it loads, as before; only the custom element defers.

#### Scenario: mountViewer

- **WHEN** a host calls `mountViewer` on a container below the fold
- **THEN** the viewer boots without waiting for the container to be near the viewport

### Requirement: The element bundle's eager graph stays small

The element entry and every file it imports statically SHALL stay within their own gzip budget, and SHALL contain no three.js; the viewer's code SHALL be reachable from the element entry only through a dynamic import.

#### Scenario: A static import of the viewer

- **WHEN** a change makes the element entry import the viewer statically
- **THEN** the library budget check fails, naming the element entry

### Requirement: The element hears a failure reported before the boot's first await

A viewer whose boot fails before its first await (no WebGL 2 context) SHALL still reach the element's subscriptions: the element SHALL fire `jeex-error` with that failure's code and enter `:state(error)`. The same holds for `error` listeners a host adds right after `mountViewer` returns.

#### Scenario: WebGL 1 only

- **WHEN** an element starts in a browser that gives no WebGL 2 context
- **THEN** it fires `jeex-error` with code `webgl-unavailable` and matches `:state(error)`
