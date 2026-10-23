# Tasks

## 1. Measure the baseline (heavy queue)

- [x] 1.1 On the GPU and on SwiftShader, bare embed page, median of 5: the first-draw task length, the self time of `getProgramParameter`/`getProgramInfoLog` inside it (CPU profile), the synchronous time of `compile()` itself, total blocking time; also with `KHR_parallel_shader_compile` stubbed to null. Record.
  - Method: bare `embed.html` of an unminified build, Chromium, 900x600, median of 5; the program-status wait is timed by wrapping `getProgramParameter`/`getProgramInfoLog` inside the rAF callback that makes the first default-framebuffer draw (the V8 profile attributes these native calls to three's callers, so its self time read 0). Before: GPU first-draw task 568 ms, link wait 430 ms, TBT 1170 ms (KHR stubbed: 529 / 405 / 1100); SwiftShader 2332 / 2211 / 5350 (stubbed 2320 / 2197 / 5327); `compile()` not called. Start in tour (GPU): chain-attach task link 44 ms, next five tasks up to 205 ms (room lighting).

## 2. First frame (TDD)

- [x] 2.1 A small pure module test-first: «wait for compile or 1 s, then allow the first display draw»; resolves, never resolves, rejects, throws, renderer without `compileAsync` (draws at once); verify its unit test.
- [x] 2.2 Make room first: move `observeBox`/`devicePixelRatioOf` (or similar helpers, not `hasWebGL`, which another change touches) out of `render-runtime.ts`; then wire the gate: armed on `start()` (context restore already calls `start()` after remount, so no second path), checked BEFORE the draw-on-demand gate, never commits demand and never sets the keep-warm time, so a pending invalidate survives; verify the runtime tests and line limits (`render-runtime.ts` < 700, `viewer-app.ts` ≤ 500).
- [x] 2.3 A one-shot first-display-draw signal on the runtime (a promise or callback re-armed by `start()`); `ready`, the app-ready flag and showing the viewer wait on it, also on restore (in place of the current one-frame wait); audit the browser tests that wait on `ready` or count frames; verify the affected tests.
- [x] 2.4 The chain: before `deps.attach` in the walk-post controller, bind the composer's read buffer, `compileAsync(scene, camera)`, restore the previous target; draw directly until it resolves; measure the chain's own full-screen materials' link time at attach and compile them on a throwaway quad only if their link self time at attach exceeds 16 ms (report the number either way); verify unit/stub tests.
  - The chain's own full-screen materials linked about 115 ms at attach (above 16 ms), so they are compiled on throwaway quads (position and uv only, as three's quad); the output pass sets its defines at its first render and still links then.

## 3. Acceptance

- [x] 3.1 Browser test (heavy queue): the first display draw happens after compile resolves and at 1 s when it does not; `ready` comes after it; the first picture matches a pre-change screenshot within the repo's usual canvas tolerance.
- [x] 3.2 Repeat 1.1 after the change through the heavy queue; acceptance: link self time in the first-draw task ≤ ¼ of baseline on the GPU with parallel compilation; first picture no later than baseline + one frame without it; start in tour shows no synchronous scene re-link when the chain attaches. Report all numbers.
  - After (same method): GPU first-draw task 128 ms, link wait 23 ms (5 % of 430: passes the quarter), TBT 723 ms; KHR stubbed: link 21 ms, first picture at 1278 ms vs 1343 ms before; SwiftShader: task 141-167 ms, link 10-11 ms, first picture 1508-1537 ms vs 3221-3227 ms. Start in tour: 3 programs link in the chain-attach task (two shadow depth programs `compileAsync` never reaches, the output pass), 103 ms, no scene program re-linked; the room lighting grids still re-link later (198 ms, accepted). Two further levers were needed: the linear program set (mirrors, transmission) and the background plane, and putting compiled programs to their first use a few per task.
- [x] 3.3 README (performance note; `ready` now follows the first picture) and CHANGELOG.
