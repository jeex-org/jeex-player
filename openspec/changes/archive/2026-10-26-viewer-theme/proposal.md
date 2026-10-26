# Proposal

## Why

A host page with a cool look cannot stop the viewer from bringing a warm tone back. The 3D backdrop is a fixed beige sky with matching fog, the loading and error cards have a fixed green-black gradient, and the accent's companion shades stay gold when the accent is overridden. On a narrow embed, such as a 390 px demo hero, the controls hint also covers about half the scene When the control bar auto-hides, its "•••" reveal button fades in over the still-fading bar.

## What Changes

- The 3D backdrop follows `--jeex-backdrop` (horizon) and the optional `--jeex-backdrop-top`, read when the viewer mounts and again on `handle.refreshTheme()`. The fog follows the horizon. Walk and tour keep their HDRI sky.
- The accent's strong and muted shades derive from `--jeex-accent`. `--jeex-on-accent` becomes a documented override, and the focus ring defaults to the accent.
- A new `--jeex-state-surface` paints the loading and error cards.
- The package defaults become neutral graphite. The player site keeps its warm look through its own stylesheet.
- Below a 480 px container width, the hint collapses to an icon button that expands on demand.
- The "•••" reveal button appears only after the auto-hiding bar has faded out.

## Capabilities

### New Capabilities

- `viewer-theme`: the host-settable backdrop, accent and state surface; the neutral defaults; the live refresh.
- `compact-chrome`: the narrow-canvas hint; the reveal button waits for the bar to fade out.

### Modified Capabilities

None.

## Impact

- Code:
  - viewer.css tokens;
  - the shell's theme list and a colour resolver;
  - the stage wiring and the handle;
  - `render-runtime.ts` and `hdri-sky.ts`, a small seam agreed with the lighting zone;
  - the chrome's hint and loading states;
  - the site's demo frame stylesheet;
  - README and CHANGELOG.
- Public API: four documented properties and `refreshTheme()`. The default palette changes, so this is a minor release with a migration snippet.
- Screenshot baselines are regenerated.
