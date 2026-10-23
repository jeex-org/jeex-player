# Brainstorm

## Problem

A load-cost measurement of the player on a bare embed page (Chromium on a desktop GPU, unthrottled) shows the first frame as one 420–490 ms task, of which 347–358 ms are shader link waits at the first draw (three compiles and links every program synchronously when a material is first drawn). Under a mobile throttling simulation that task takes 1.6–1.8 s and is the second largest contributor to total blocking time on pages that embed the player.

## Related work

Other changes in flight on the same player: starting the element only near the viewport, dropping the throwaway support-probe context, chunking procedural textures (another session's zone), and drawing on demand in walk and tour (this branch).

## Decision

1. Before the first visible frame, compile the scene's programs with three's `compileAsync`, which uses the `KHR_parallel_shader_compile` extension where the browser has it, so the browser links in parallel off the main thread and the first draw finds linked programs. The loop keeps running hooks meanwhile; the first display draw waits until compilation resolves (or until a bounded time, so a driver that never reports readiness cannot keep the view blank).
2. Compile the walk and tour chain's own materials when it attaches, and compile again after a GPU context restore.
3. Facts of three r186 that bound the gain (verified by the reviewer): `compile` collects materials from the whole scene (hidden objects and other layers included) but lights only from visible objects on the camera's layers, and pushes no light-probe grids; the program key depends on the render target bound at compile time (no tone mapping and the working colour space into an ordinary target), so the walk chain's scene pass needs its own compile with the chain's read buffer bound; late-arriving models still compile at their first draw (accepted); the room lighting's grid programs are re-linked when the grids switch on (accepted, measured with the walk numbers); without the extension `compileAsync` compiles synchronously and resolves after about 10 ms, so no gain but no loss.
4. `ready`, the app-ready flag and showing the viewer move to after the first display draw, so hosts and tests never see a blank canvas while compilation runs.

## Rejected

1. Compiling in a worker or with an offscreen context: programs are per context.
2. Waiting with no time bound: a blank view if readiness is never reported.

## Process

Taken over from a measurement by another session with its numbers and call sites; reviewed by an independent agent.
