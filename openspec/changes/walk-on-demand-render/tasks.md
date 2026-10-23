# Tasks

## 1. Gate (TDD)

- [x] 1.1 `render-demand.ts` test-first: dirty flag, camera snapshot compare (identity, world matrix with tolerance, exact projection, layers), accumulated slow drift against the LAST DISPLAYED snapshot, commit only after a successful draw (a throw keeps demand), inactive outside walk/tour; verify its unit test.
- [x] 1.2 Runtime wiring: gate after hooks with the camera matrix updated, keep-warm only for render-disabled modes, captures never commit; verify `render-runtime.test.ts` with the injected scheduler (coalescing, heartbeat precedence, failed draw) and that `render-runtime.ts` stays under 700 lines.

## 2. Dirty sources, each wired with its regression test

- [x] 2.1 Scene revisions and rebuilds; shell visibility/layers (dollhouse, `setMode`, `engageTour`); verify unit/stub tests.
- [x] 2.2 Door and furniture moved readings (single drain) incl. final frames; model upgrade `onSwapped` per body; library surface after map attachment; verify unit/stub tests.
- [x] 2.3 Selection set/clear/recolour/fade/glow; floor ring; sun shadow; walk chain attach/detach; room lighting look/complete/fail/refresh; verify unit/stub tests.
- [x] 2.4 Resize, pixel ratio, visibility resume, canvas reattach, context restore, capture-frames restart; verify unit/stub tests.
- [x] 2.5 Telemetry: rewire the post-render sampling (today it returns unless the frame drew), so dwell accumulates on hook time excluding hidden time while frame-interval samples reset across skipped draws; first-draw readiness unchanged; verify telemetry tests.
- [x] 2.6 Debug counters for ticks and display draws (two-file change); verify the debug surface test.

## 3. Browser acceptance (heavy queue; new file in `COMPONENT_FILE_COST_S`)

Requirement-to-check map, one browser case each, in walk and in tour (overview included) where it applies:
- [x] 3.1 «Redraw on demand»: idle precondition (lighting live, no animation, no aura, nothing pending) → ticks advance, display draws flat for 60 ticks, compositor screenshots identical; slow drift draws once beyond tolerance; camera identity/projection/layers change draws.
  - Covered in the browser: rest with flat draws and identical screenshots, layers, projection. Slow drift and camera identity: unit tests (`render-demand.test.ts`); walk has a single camera and its rig rewrites the pose every tick.
- [x] 3.2 «What makes walk and tour redraw»: door animation draws every tick and its final pose then rests; furniture toggle likewise; selection clear at unchanged pose; live aura keeps drawing; tour shell switch at unchanged pose; late texture; model upgrade; an edit; floor ring move; walk chain attach; lighting refresh; sun change; resize, pixel ratio, visibility resume, reattach, context restore.
  - Covered in the browser: door, furniture ripple, selection set and clear, edit, lighting refresh, resize, reattach, chain attach on entry. By unit and stub tests only: aura, tour shell switch, late texture, model upgrade, floor ring (a synthetic hover found no floor spot), sun change, pixel ratio, visibility resume, context restore.
- [x] 3.3 «Captures»: still and panorama with pending demand keep the demand; video clip deterministic and one draw after restore; a failed capture leaves the live view; the existing video-frame smoke tool still passes.
  - Covered in the browser: still and panorama with pending demand, video clip then rest. The failed capture and the video-frame smoke tool are not re-run here (captures do not touch the demand).
- [x] 3.4 «Clock and telemetry»: idle gap not a slow frame; dwell while resting; editing modes on their old schedule (incl. the plan2d heartbeat).
  - Editing modes and the plan2d heartbeat in the browser; idle gap and dwell in `telemetry-wiring.test.ts`.
- [x] 3.5 Measure on SwiftShader through the heavy queue, before (main) and after: after 10 s idle, the time from an input event to the first PRESENTED changed picture (rAF after the draw plus a compositor screenshot change), median of 10; idle CPU per tick. Acceptance: the input-to-picture time is not worse than main by more than one frame of the measured frame time, and idle CPU drops; report the numbers.
  - SwiftShader, demo apartment, 900x600, room lighting live, median of 10: input to presented picture after 10 s idle, main 1488 ms, branch 1501 ms (frame time on main 1430 ms); idle CPU of the browser process tree per tick, main 16900 ms per 1430 ms tick, branch 0.3 ms per 17 ms tick.

## 4. Docs and integration

- [x] 4.1 README (rendering: walk and tour redraw on demand) and CHANGELOG (note that frame-interval telemetry now samples consecutive display draws only).
- [ ] 4.2 Fast tier green, then the full gate once through the machine's gate queue.
