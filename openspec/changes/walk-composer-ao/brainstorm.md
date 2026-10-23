# Brainstorm

## Problem

Every camera mode renders straight to the screen with PBR Neutral tone mapping and no contact shadows: corners, skirtings and furniture feet do not darken, and walk-mode edges alias once the default framebuffer's antialiasing is the only help. Walk and tour, where nothing is edited, should get ambient occlusion and SMAA through a post-processing chain; editing modes must stay exactly as fast as now. The heavy code must not grow the boot download of the ES and demo builds.

## Related work

1. The sun-shadow change (landed just before) wraps the renderer's shadow pass for a shadow-only layer and caches the sun shadow per light; the composer's scene pass runs inside `renderer.render`, so both keep working, and context restore already reinstalls the adapter.
2. A parallel change rewrites materials and the manifest; it does not touch rendering passes.
3. Later lighting steps (room probes, probe grid, HDRI sky, quality tiers) will plug into the same walk/tour chunk; quality tiers will measure GTAO against N8AO on phones.

## Doubts

1. Lazy loading in the IIFE build.
2. Tone mapping under a half-float composer target; double tone mapping.
3. GTAO inputs, cost, glass, invisible pick proxies, overlays.
4. SMAA placement and colour space.
5. Pixel ratio, resize, MSAA.
6. Stills, panoramas, video frames taken in walk/tour.
7. The mirror capture gate under a composer.
8. Context loss and disposal.
9. Mode switching while the chunk loads; tour start shell.
10. Tests that prove AO and SMAA without brittle baselines.

## Approaches considered

1. **Lazily loaded walk/tour post-processor behind a small render seam (author, refined by partner).** A contract module, an implementation module and an app-side controller; the runtime renders through the processor when one is attached, straight otherwise. Composer kept between visits, detached while editing.
2. **Always-on composer with passes toggled (author).** A full-screen copy in editing modes and the code at boot.
3. **pmndrs `postprocessing` + N8AO (author).** Two new dependencies with a peer range pinned to three minors; the product spec defers GTAO vs N8AO to the phone measurement of the quality-tier step.
4. **Mirror capture from a frame hook (author).** Loses three's matrix-update ordering inside `renderer.render`; the partner showed a scoped scene-pass predicate keeps `onBeforeRender` and is exact.

Facts the partner verified in the installed three r186 and Vite:
1. Vite builds IIFE with code splitting off, so `import()` is inlined there.
2. Rendering into an ordinary target applies no tone mapping and keeps working-space colour; `OutputPass` applies the renderer's tone mapping, exposure and output colour space once. Renderer tone mapping stays Neutral.
3. `SMAAPass` requires linear input: the chain is RenderPass → GTAO → SMAA → OutputPass.
4. `RenderPass` binds the composer's read buffer and does not swap.
5. Stock `GTAOPass` renders the scene a second time with `MeshNormalMaterial`, filters only lines and points, and so treats glass and zero-opacity pick proxies as occluders; its `dispose` omits one material; `EffectComposer.dispose` does not dispose passes.
6. The tour starts in the dollhouse shell (`engageTour`), so "walk/tour" and "dollhouse renders directly" overlap.

## Decision

Approach 1.

1. **Eligibility by camera mode.** Post-processing is on while the camera mode is `walk` or `tour`, whatever the shell state; the tour's overview arc is part of a tour where nothing is edited. Editing modes (`plan2d`, `plan3d`, `orbit`) render straight to the screen as now.
2. **Chain.** Half-float composer targets without MSAA: RenderPass → GTAO (world-space radius 0.3 m, near/far 0.1/160 m, half-resolution AO buffer, denoise on) → SMAA → OutputPass. Renderer tone mapping stays Neutral; OutputPass applies it once.
3. **GTAO visibility.** The AO normal/depth pass skips transparent and transmissive materials, invisible pick proxies, helpers and the overlay layer; overlays that remain in the beauty pass accept the AO factor of the floor under them (the floor ring sits on open floor).
4. **Mirror gate.** A per-renderer scene-pass scope in `src/shared/` names the exact target, scene and camera of the current beauty pass; `mainPassOnly` captures only when the bound target, scene and camera match the scope; the runtime scopes its direct render too, so inset previews that draw to the screen stay excluded with transmission and AO inputs.
5. **Captures.** Stills and video frames taken in walk/tour go through the same chain instance at capture resolution (one GTAO noise, repeatable), so a captured frame matches the screen; panoramas keep today's path (AO across cube faces needs a seam-safe design, out of scope). Colour is one pipeline everywhere already.
6. **Loading and lifecycle.** Render directly while the chunk loads; attach only if the viewer is still eligible and its GPU context generation is unchanged; wait for SMAA's textures to decode before attaching. Dispose every pass individually (including GTAO's blend material); rebuild after a context restore.
7. **Sizes.** The composer follows the renderer's logical size and effective pixel ratio once (no double multiplication); the AO pass scales what it receives to half resolution on every resize.
8. **Delivery.** `import()` from the walk/tour controller: a lazy chunk in ES and the demo, inline in the IIFE.
9. **GTAO now, N8AO later.** GTAO is in three (no dependency); it sits behind the post-processor contract so the quality-tier step can replace it after measuring both on phones.

## Rejected

1. Always-on composer: costs editing modes and loads the code at boot.
2. pmndrs + N8AO now: two dependencies before the measurement the product spec requires.
3. Frame-hook mirror capture: lags the camera by a frame or redoes matrix updates.
4. SMAA after OutputPass: the installed SMAA expects linear input.
5. Tone mapping off on the renderer while the composer runs: OutputPass reads it and would apply none.
6. Effects on panoramas now: seams between cube faces.

## Open questions

None left. IIFE delivery was decided by the project lead: the ES, demo and iframe builds load the chain lazily; the IIFE build carries it inline (it cannot split code); a separately built IIFE sidecar only if a later phone measurement shows the first-load cost matters.

## Process

One round with an independent partner agent, read-only, given the problem, three approaches and ten doubts. The partner verified the engine and build facts listed above, corrected the SMAA placement, found the tour/dollhouse overlap, the GTAO visibility gaps and the IIFE limitation, and proposed the scoped mirror predicate.
