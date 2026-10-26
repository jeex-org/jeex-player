# Design

## Context

The theming surface is `.jeex-viewer` custom properties in `@layer component` (viewer.css). The runtime draws a fallback sky from fixed constants (`render-runtime.ts`), and `hdri-sky.ts` saves that background and fog and restores them when walk or tour ends. The brainstorm settled the mechanism and the defaults.

## Goals / Non-Goals

Goals:
- the backdrop, accent and state surface are themed from CSS;
- neutral defaults;
- a live refresh;
- the two chrome fixes on narrow embeds.

Non-goals:
- transparent rendering;
- theming the HDRI, exposure or materials;
- a style observer;
- re-theming the plan 2D drawing;
- theming an iframe embed from the parent page.

## Decisions

### Colour resolution

`resolveThemeColour(root, property, fallback)` lives in its own module (`ui/theme-colour.ts`).
1. It reads the root's computed custom property and rejects a value for which `CSS.supports('color', v)` is false.
2. It sets the value as the `color` of a hidden probe inside the root, so that `light-dark()` and `var()` resolve in the root's scheme.
3. It paints the computed colour on a 1×1 canvas and reads the pixel back as opaque hex; alpha is dropped. The computed form of `color-mix()` is `color(srgb …)` or `oklch(…)`, not `rgb()`, so it is never parsed by hand.

The fallbacks are the neutral defaults: `#303640`, and that colour with 8% white for the top. The runtime constants are only the value before the first resolve.

### Runtime seam (lighting zone, agreed)

- `RenderRuntime.setBackdrop({ top, horizon })` builds its OWN gradient canvas texture, not the shared cache. The shared cache can only free everything at once, and two viewers with the same colours would share one object.
- It disposes the previous texture it built. The constructor's initial sky moves to the same owned path, so `dispose()` frees it too.
- The runtime keeps its own `Fog` reference and sets `.color` to the horizon. `HdriSky.save()` holds that same object, so the restored fallback follows. `scene.fog` is null while the HDRI is up, and the runtime never reads it.
- With the HDRI active, the background goes to the saved fallback through `HdriSky.setFallbackBackground(texture)` and the live scene is left alone.
- It requests a frame. The constants stay as the initial value.
- A refresh during an in-flight capture, which borrows the background, could re-upload a freed texture for one frame. This is unlikely, cosmetic and not guarded.
- The seam adds at most about 40 lines to `render-runtime.ts` (655 lines today). The texture builder sits beside `skyTexture` in `textures.ts`.

### Wiring

- The stage calls the resolver after the root is attached and before the first render.
- `ViewerHandle.refreshTheme()` re-runs it.
- The lazy element's pending handle forwards the call once started, and does nothing before start, because the mount resolves the theme anyway.
- The iframe protocol gets no `refreshTheme`, because a parent page's CSS cannot reach the frame.
- `THEME_PROPERTIES` gains the four properties.

### CSS

- Neutral values per the brainstorm.
- `--jeex-accent-strong: light-dark(color-mix(in oklch, var(--jeex-accent), black 22%), color-mix(in oklch, var(--jeex-accent), white 22%))`. Plain `color-mix()` sits inside `light-dark()`, never the other way round, so the nested form is never needed at the floor. Muted is built the same way, toward the surface text.
- Contrast is pinned for the default accent in both schemes. The README tells a host that sets a very light or very dark accent to set `--jeex-on-accent` too.
- `--jeex-backdrop-top` defaults to `color-mix(in srgb, var(--jeex-backdrop), white 8%)`.
- `.state-card` and `.loading-state` paint `var(--jeex-state-surface)`.

### Mini-map accent

The mini-map paints on a canvas, so its view cone and current-camera dot were fixed colours (`#e08a3c`, `#dfbd7d`). `paintPlan` takes an optional `accent`. The mini-map gets `setAccent(hex)`, fed by the stage from `--jeex-minimap-accent`, which is resolved like the backdrop at mount and on `refreshTheme()`. That token is derived and not part of the contract: by default it is the accent mixed 35% towards black, so a light dark-scheme accent still reads on the mini-map's white paper. The 2D plan drawing (`plan2d`) keeps its own palette, as stated in the non-goals.

### Hint

- `.hint-card` (part `hint`) and `.hint-text` (`aria-live`) are unchanged.
- A `.hint-toggle` button is added inside the card with the icon. It is `display: none` by default, so it is out of the tab order when wide, and shown in `@container (max-width: 479.98px)`, the same query form as the existing 430/600/740 queries. There, `.hint-text` is hidden unless the card has `data-expanded`.
- The toggle has `aria-expanded`, `aria-controls` pointing at the hint text, and a static accessible name from an existing message.
- A click or Enter toggles. The first camera gesture collapses: the camera controls' drag or wheel start, ignoring events whose target is inside the card. The chrome's wake signal is not used, because it fires on pointer movement and focus and is off when `autoHide` is false.
- The 'hint' chrome flag still hides the whole card.
- Mind the line budget: `viewer-shell.ts` is 675 lines and `viewer-chrome.ts` 664. The toggle logic goes into its own small module if needed.

### Reveal button

`.reveal-controls.is-visible` gets a `transition-delay` equal to the control bar's fade duration, so the button starts after the bar has gone. The hidden state keeps a zero delay, so the button leaves at once when the bar returns. Nothing else about auto-hide changes.

### Site

- `scripts/site-build.ts` copies `site/assets/demo-theme.css` into `out/demo/` and adds a `<link>` only to `out/demo/embed.html`. `dist` and `dist-lib` stay neutral.
- The rule is unlayered and targets `.jeex-viewer` directly, because the defaults are declared on that root in `@layer component`.
- It sets the former warm values, including the backdrop pair `#c6b8a3` / `#dcd3c2`.
- A site-build test checks that the link is present only there.

## Risks / Trade-offs

- A visible default change for existing embedders. It is mitigated by a minor release and the migration snippet in the CHANGELOG.
- About 18 screenshot baselines change. They are regenerated in this PR through the heavy queue.
- `color-mix()` shades are tuned by eye. The contrast tests pin the on-accent and focus legibility.
