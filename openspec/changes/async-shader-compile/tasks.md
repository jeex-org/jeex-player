# Tasks

## 1. Measure the baseline (heavy queue)

- [ ] 1.1 On the GPU and on SwiftShader, bare embed page, median of 5: the first-draw task length, the self time of `getProgramParameter`/`getProgramInfoLog` inside it (CPU profile), the synchronous time of `compile()` itself, total blocking time; also with `KHR_parallel_shader_compile` stubbed to null. Record.

## 2. First frame (TDD)

- [ ] 2.1 A small pure module test-first: «wait for compile or 1 s, then allow the first display draw»; resolves, never resolves, rejects, throws, renderer without `compileAsync` (draws at once); verify its unit test.
- [ ] 2.2 Make room first: move `observeBox`/`devicePixelRatioOf` (or similar helpers, not `hasWebGL`, which another change touches) out of `render-runtime.ts`; then wire the gate: armed on `start()` (context restore already calls `start()` after remount, so no second path), checked BEFORE the draw-on-demand gate, never commits demand and never sets the keep-warm time, so a pending invalidate survives; verify the runtime tests and line limits (`render-runtime.ts` < 700, `viewer-app.ts` ≤ 500).
- [ ] 2.3 A one-shot first-display-draw signal on the runtime (a promise or callback re-armed by `start()`); `ready`, the app-ready flag and showing the viewer wait on it, also on restore (in place of the current one-frame wait); audit the browser tests that wait on `ready` or count frames; verify the affected tests.
- [ ] 2.4 The chain: before `deps.attach` in the walk-post controller, bind the composer's read buffer, `compileAsync(scene, camera)`, restore the previous target; draw directly until it resolves; measure the chain's own full-screen materials' link time at attach and compile them on a throwaway quad only if their link self time at attach exceeds 16 ms (report the number either way); verify unit/stub tests.

## 3. Acceptance

- [ ] 3.1 Browser test (heavy queue): the first display draw happens after compile resolves and at 1 s when it does not; `ready` comes after it; the first picture matches a pre-change screenshot within the repo's usual canvas tolerance.
- [ ] 3.2 Repeat 1.1 after the change through the heavy queue; acceptance: link self time in the first-draw task ≤ ¼ of baseline on the GPU with parallel compilation; first picture no later than baseline + one frame without it; start in tour shows no synchronous scene re-link when the chain attaches. Report all numbers.
- [ ] 3.3 README (performance note; `ready` now follows the first picture) and CHANGELOG.
