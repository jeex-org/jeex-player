# Tasks

## 1. Gate (TDD)

- [ ] 1.1 `render-demand.ts` test-first: dirty flag, camera snapshot compare (identity, world matrix with tolerance, exact projection, layers), accumulated slow drift against the LAST DISPLAYED snapshot, commit only after a successful draw (a throw keeps demand), inactive outside walk/tour; verify its unit test.
- [ ] 1.2 Runtime wiring: gate after hooks with the camera matrix updated, keep-warm only for render-disabled modes, captures never commit; verify `render-runtime.test.ts` with the injected scheduler (coalescing, heartbeat precedence, failed draw) and that `render-runtime.ts` stays under 700 lines.

## 2. Dirty sources, each wired with its regression test

- [ ] 2.1 Scene revisions and rebuilds; shell visibility/layers (dollhouse, `setMode`, `engageTour`); verify unit/stub tests.
- [ ] 2.2 Door and furniture moved readings (single drain) incl. final frames; model upgrade `onSwapped` per body; library surface after map attachment; verify unit/stub tests.
- [ ] 2.3 Selection set/clear/recolour/fade/glow; floor ring; sun shadow; walk chain attach/detach; room lighting look/complete/fail/refresh; verify unit/stub tests.
- [ ] 2.4 Resize, pixel ratio, visibility resume, canvas reattach, context restore, capture-frames restart; verify unit/stub tests.
- [ ] 2.5 Telemetry: frame-interval reset across skipped draws, dwell on hook time excluding hidden time, first-draw readiness unchanged; verify telemetry tests.
- [ ] 2.6 Debug counters for ticks and display draws (two-file change); verify the debug surface test.

## 3. Browser acceptance (heavy queue; new file in `COMPONENT_FILE_COST_S`)

Requirement-to-check map, one browser case each, in walk and in tour (overview included) where it applies:
- [ ] 3.1 «Redraw on demand»: idle precondition (lighting live, no animation, no aura, nothing pending) → ticks advance, display draws flat for 60 ticks, compositor screenshots identical; slow drift draws once beyond tolerance; camera identity/projection/layers change draws.
- [ ] 3.2 «What makes walk and tour redraw»: door animation draws every tick and its final pose then rests; furniture toggle likewise; selection clear at unchanged pose; live aura keeps drawing; tour shell switch at unchanged pose; late texture; model upgrade; an edit; floor ring move; walk chain attach; lighting refresh; sun change; resize, pixel ratio, visibility resume, reattach, context restore.
- [ ] 3.3 «Captures»: still with pending demand keeps the demand; video clip deterministic and one draw after restore; a failed capture leaves the live view; the existing video-frame smoke tool still passes.
- [ ] 3.4 «Clock and telemetry»: idle gap not a slow frame; dwell while resting; editing modes on their old schedule (incl. the plan2d heartbeat).
- [ ] 3.5 Measure on SwiftShader through the heavy queue, before (main) and after: after 10 s idle, the time from an input event to the first PRESENTED changed picture (rAF after the draw plus a compositor screenshot change), median of 10; idle CPU per tick. Acceptance: the input-to-picture time is not worse than main by more than one frame of the measured frame time, and idle CPU drops; report the numbers.

## 4. Docs and integration

- [ ] 4.1 README (rendering: walk and tour redraw on demand) and CHANGELOG.
- [ ] 4.2 Fast tier green, then the full gate once through the machine's gate queue.
