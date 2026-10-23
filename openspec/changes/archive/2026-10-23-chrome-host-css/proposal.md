# Proposal

## Why

A viewer mounted with `mountViewer` sits in the host page's light DOM, and the player's whole stylesheet is layered, so any unlayered element rule of the host (`button {}`, `* {}`, `body { font }`) restyles the chrome: buttons grow, the control bar overflows on a phone and cuts off «2D» and fullscreen, the active mode loses its highlight. Client agency and CMS sites ship exactly such global CSS, so the light-DOM embed breaks on the sites it is meant for.

## What Changes

- The chrome on the light-DOM path keeps its own look on a page with aggressive global CSS: unlayered element rules, the universal selector, body typography, and rules of one class, attribute or pseudo-class with one element name no longer reach the chrome's elements.
- Host rules with two or more classes, attributes or pseudo-classes, an ID, or `!important` still reach them; documented as the limit.
- **BREAKING (light DOM only):** a host rule that restyles a chrome element with a weak selector (`.mode-button {}`) no longer wins; a rule naming the viewer root and the element (`.jeex-viewer .mode-button {}`) does. Theming custom properties, `::part()`, host slots and their content, and the root element's own box behave as before.
- The custom element's shadow path is unchanged.
- The README's limit note and theming section say what is protected and what is not.

## Capabilities

### New Capabilities

- `chrome-style-isolation`: how the viewer chrome holds its look against the host page's own stylesheets, and which host hooks keep working.

### Modified Capabilities

None.

## Impact

`src/ui/styles/viewer.css` (one unlayered guard rule, one typography boundary in the reset layer), a hostile host page under `dev/` and its e2e spec, README («What a pasted form does on its own», «Theming»). No API, option or dependency changes.
