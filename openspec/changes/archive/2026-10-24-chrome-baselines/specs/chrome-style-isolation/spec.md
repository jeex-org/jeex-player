# Spec Delta

## MODIFIED Requirements

### Requirement: Generic host rules do not reach the chrome on the light-DOM path

When the viewer is mounted into the host document's light DOM, UNLAYERED host rules no heavier than one class, attribute or pseudo-class plus up to three element names SHALL NOT change the size, position or computed look of any chrome element below the viewer root. The root's own box stays the host's to size.

#### Scenario: A page with aggressive global CSS

- **WHEN** a viewer is mounted with `mountViewer` into a page whose unlayered sheet resets `*`, sets body typography, and styles `button`, `select`, `input`, `a`, `svg`, `img`, `span`, `p` and `label`, plus `.site-content button`, `.site-content main button` and `.entry-content div span`
- **THEN** every rendered chrome element (control bar, mode switcher, icon buttons, interior-style popover, reveal pill, hint card, degraded-asset notice) has the same box and the same computed font, colour, background, border, radius, padding, margin, minimum size and outline as with that sheet disabled, also with a mode button hovered and an icon button keyboard-focused

#### Scenario: Pixels of the chrome

- **WHEN** the same page is photographed with the scene canvas left unpainted, with the host sheet enabled and disabled, at 390×844 and at 1280×800
- **THEN** the two pictures differ in no more than 2 % of the pixels
