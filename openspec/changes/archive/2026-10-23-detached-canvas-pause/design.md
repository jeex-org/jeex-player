# Design

## Context

The runtime's loop already pauses for a hidden document and checks `checkVisibility()` on resume, but the frame callback itself never looked at the canvas, so a viewer removed from the page kept drawing. The viewer root is both the element the runtime's `ResizeObserver` watches and the parent of the canvas. The custom element disposes on disconnect and survives `moveBefore()`, so only `mountViewer` hosts are affected. See proposal.md for the motivation.

## Goals / Non-Goals

**Goals:** stop drawing into a detached canvas; resume when it is connected again; no new listener, observer or timer.

**Non-Goals:** disposing on detach; pausing for a canvas that is connected but `display: none` (a separate change to the visibility rule); stopping the other cheap work a leaked viewer keeps (the telemetry timer).

## Decisions

- **Detection: `canvas.isConnected` at the top of each frame, before the next frame is requested.** One property read per frame. `checkVisibility()` per frame was rejected: it can force a style computation on every frame.
- **Wake: the existing box observer.** Insertion into and removal from a document is an observation of the observed element, wherever in the ancestor chain the removal happened, so the observer callback calls `resume()` after it has queued its coalesced resize (the first resumed frame then draws at the restored size). Rejected: a document-wide `MutationObserver` per viewer (cost, misses another document), a low-rate poll (a timer that wakes the page forever for every leaked viewer), `connectedCallback` (only the custom element has one, and it disposes anyway).
- **Cross-browser check of the wake signal.** A probe page (a box with a canvas inside, observed by a `ResizeObserver`) was run in Chromium and Firefox: removing an ancestor, removing the observed element, and re-inserting either each delivered one observation (`0x0` with the canvas disconnected, then the full box with it connected). WebKit could not be run on the development machine (missing system libraries); its behaviour rests on the specification text that insertion into and removal from the DOM is an observation, and is the one residual risk.
- **Park only where the observer exists.** Without it nothing could end the park, and a viewer put back would freeze; with it missing (a viewport given without an element) the old behaviour stays.
- **A detached canvas is not visible.** `resume()` (from `start()`, a context restore or a visibility change) does not schedule a frame for it.
- **Listener policy:** no `addEventListener` is added; the observer is disconnected in `dispose()` as before.

## Risks / Trade-offs

- [A loop started while its canvas was `display: none` now starts when its box appears, through the same observer call] → named in the proposal and the changelog; it is what the visibility rule already promised.
- [Telemetry frame gaps] → the parked stretch is a gap like a hidden tab; the frame clock is re-synchronised on resume, and the existing telemetry rule already treats gaps over 1 s as pauses (no new behaviour, so no new scenario).
- [WebKit not run locally] → a WebKit that skipped the removal notification would leave a viewer that is put back parked; the specification requires the notification, and the browser test covers Chromium.
- Guards considered and left out as speculative: a canvas adopted into another document (stays connected, never parks; rare; costs nothing to leave), re-insertion into a `display: none` subtree (no observation until it is shown, and then it resumes; correct as is), a timeout fallback should the observer miss an insertion (the observer behaviour is specified and checked by the browser test; a fallback would be a timer per viewer).
