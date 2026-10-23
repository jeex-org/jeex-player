# Design

## Context

See proposal.md. Engine and build facts that shape the design (three r186 and Vite as installed):

1. Rendering into an ordinary render target applies no tone mapping and keeps working-space colour; `OutputPass` applies the renderer's tone mapping, exposure and output colour space. The renderer keeps PBR Neutral.
2. `SMAAPass` expects linear input; its embedded textures decode asynchronously.
3. `RenderPass` renders into the composer's read buffer, without swapping.
4. `GTAOPass` renders the scene again with `MeshNormalMaterial`, filters only lines and points, and does not dispose its blend material; `EffectComposer.dispose` does not dispose passes.
5. Vite builds the IIFE library without code splitting; `import()` is inlined there.
6. `mirror-capture.ts` treats "no render target bound" as the main pass.
7. `render-runtime.ts` (636 lines), `viewer-stage.ts` (493) and `viewer-app.ts` (499 of its 500) take only wiring.
8. The tour starts in the dollhouse shell (`camera-director.ts` `engageTour`).

## Goals / Non-Goals

**Goals:** the chain in walk/tour, untouched editing modes, lazy loading in ES/demo, mirrors and captures correct under the chain, clean lifecycle.

**Non-Goals:** N8AO or pmndrs (quality-tier step, after phone measurement), MSAA on composer targets, quality tiers, effects on panoramas, an IIFE sidecar.

## Decisions

1. **Modules.** `src/render/post-processor.ts`: the contract (`render(scene, camera, dt)` to the screen, `renderTo(target, scene, camera, width, height)` for captures, writing the display-referred image into the caller's 8-bit target and restoring the chain's size and the renderer's target before returning, `setSize(width, height, pixelRatio)`, `dispose()`), importable by the runtime without three addons. `src/render/walk-post.ts`: the chain built from three's addons, the only importer of `EffectComposer`, `RenderPass`, `GTAOPass`, `SMAAPass`, `OutputPass`. `src/app/walk-post-controller.ts`: eligibility, `import()` of `walk-post`, attach/detach, context generation, disposal. The runtime gains one seam: `setPostProcessor(p | null)`; its frame renders through `p` when set.
2. **Eligibility** is a pure function of the camera mode (`walk`, `tour`) evaluated after camera and tour updates each frame, so initial tour embeds and manual takeovers are covered. The shell state does not matter.
3. **Chain.** Half-float composer targets, `samples = 0`. RenderPass → GTAO → SMAA → OutputPass. GTAO: world-space radius 0.3 m, camera near/far as the walk camera, AO buffer at half the drawing-buffer size (re-applied on every `setSize`), denoise on. Values live in one frozen tuning object in `walk-post.ts`, tested.
4. **GTAO visibility.** Before the AO input pass, a pure classifier decides per mesh: occludes only if it is visible, on layer 0 (a dollhouse wall that also carries the shadow-only layer still occludes; an object ONLY on custom layers does not), and every material in its material array is opaque (`transparent` false, `transmission` 0, `opacity` 1, `visible` true, not `colorWrite: false`); otherwise it is hidden for the AO input and restored in `finally`. Pick proxies are caught by their invisible material, not by metadata. The classifier is unit-tested; the wrapper is local to `walk-post.ts`.
5. **Mirror gate.** `src/shared/scene-pass.ts` keeps, per renderer, the current beauty pass `{ target, scene, camera }`; the runtime sets it around its direct render, the walk chain around its RenderPass and the capture path around its beauty render, each cleared in `finally`. `mainPassOnly` captures only when a scope is set and the bound target, the scene and the camera all match it; with no scope (inset previews, swatches, transmission, AO input) it does not capture. `assets/` imports `shared/`, not `render/`.
6. **Captures.** In walk/tour `capture-commands.ts` awaits the controller's chain (loading it if needed; on failure the direct path) and calls `renderTo` with the capture size; `still-capture.ts`' own display shader is bypassed then, so the transform is applied once. `video-frames` gets its frames through the same capture command. One chain instance serves live and captures, so the GTAO noise is the same and repeated captures are identical. Panoramas are unchanged.
7. **Loading.** `import('../render/walk-post.js')` on first eligible frame; while pending, direct rendering; on resolve, attach only if still eligible, not disposed and the context generation unchanged; await SMAA texture decode before attaching. A rejected import reports one viewer error and is not retried until the next entry.
8. **Lifecycle.** Kept between visits (detached in editing modes), sized on every renderer resize with the logical size and the runtime's effective pixel ratio, disposed pass by pass (GTAO's blend material included) on viewer dispose and on context loss, rebuilt on restore.
9. **Budgets.** The lazy chunk gets its own entry in the per-lazy-file budget; a test asserts the ES boot graph does not include `walk-post`. The IIFE budget rises by the measured size, still within 700 KB.

## Risks / Trade-offs

1. [GTAO cost on phones] → half-resolution AO now; the quality-tier step measures GTAO against N8AO on two phones.
2. [Overlays keep the floor's AO factor] → the floor ring sits on open floor; accepted.
3. [IIFE carries the chain] → decided by the project lead; sidecar only if the measurement shows it matters.
4. [Memory: about 63 MiB of colour targets at 1920×1080 before AO] → editing modes detach the chain; tiers later lower resolution.
5. [Mirror brightness] → checked by eye and by a pixel test against the direct path.

## Migration Plan

No data or API migration. Rollback is a revert.
