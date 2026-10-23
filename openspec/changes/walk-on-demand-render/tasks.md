# Tasks

## 1. Gate (TDD)

- [ ] 1.1 `render-demand.ts` test-first: dirty flag, camera snapshot compare (tolerance on world matrix, exact projection, layers, identity), commit only after draw, inactive outside walk/tour; verify its unit test.
- [ ] 1.2 Runtime wiring: gate after hooks with the camera matrix updated, keep-warm only for render-disabled modes, captures never commit; verify `render-runtime.test.ts` with the injected scheduler (coalescing, accumulated slow movement, heartbeat precedence) and that `render-runtime.ts` stays under 700 lines.

## 2. Dirty sources

- [ ] 2.1 Wire every source of design decision 3, each with a unit or stub test where the source is pure; verify those tests.
- [ ] 2.2 Telemetry sampling and room dwell adjusted; verify telemetry tests.
- [ ] 2.3 Debug counters (two-file change); verify the debug surface test.

## 3. Browser acceptance (heavy queue; new file in `COMPONENT_FILE_COST_S`)

- [ ] 3.1 After the lighting is live: counters flat over 60 idle ticks and compositor screenshots identical; then one test per change family of the spec scenario «Every change draws once»; movement after a long idle draws on the next tick; captures unaffected; editing modes draw every frame.
- [ ] 3.2 Measure on SwiftShader: input-to-first-draw after idle and idle CPU per tick, before and after; report.

## 4. Docs and integration

- [ ] 4.1 README (rendering: walk and tour redraw on demand) and CHANGELOG.
- [ ] 4.2 Fast tier green, then the full gate once through the machine's gate queue.
