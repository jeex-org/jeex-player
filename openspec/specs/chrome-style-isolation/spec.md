# chrome-style-isolation Specification

## Purpose
Keeps the viewer chrome looking like itself when the viewer is mounted into a host page whose own global CSS styles buttons, text, icons and images, while every documented host styling hook keeps working.

## Requirements

### Requirement: Generic host rules do not reach the chrome on the light-DOM path

When the viewer is mounted into the host document's light DOM, UNLAYERED host rules no heavier than one class, attribute or pseudo-class plus up to three element names SHALL NOT change the size, position or computed look of any chrome element below the viewer root. The root's own box stays the host's to size.

#### Scenario: A page with aggressive global CSS

- **WHEN** a viewer is mounted with `mountViewer` into a page whose unlayered sheet resets `*`, sets body typography, and styles `button`, `select`, `input`, `a`, `svg`, `img`, `span`, `p` and `label`, plus `.site-content button`, `.site-content main button` and `.entry-content div span`
- **THEN** every rendered chrome element (control bar, mode switcher, icon buttons, interior-style popover, reveal pill, hint card, degraded-asset notice) has the same box and the same computed font, colour, background, border, radius, padding, margin, minimum size and outline as with that sheet disabled, also with a mode button hovered and an icon button keyboard-focused

#### Scenario: Pixels of the chrome

- **WHEN** the same page is photographed with the scene canvas left unpainted, with the host sheet enabled and disabled, at 390×844 and at 1280×800
- **THEN** the two pictures differ in no more than the chrome tolerance of the other chrome baselines (2 % of the pixels)

### Requirement: Deliberate host styling keeps working

The theming custom properties on the viewer root, `::part()` rules, the viewer root element's own styles, host slot boxes and the host content inside them SHALL behave as they did before. A host rule that names the viewer root and a chrome element SHALL still override that element.

#### Scenario: Theming properties

- **WHEN** a host sets `--jeex-accent` or any other theming property on the viewer root with an unlayered rule
- **THEN** the chrome follows it on both the light-DOM and the shadow path

#### Scenario: A named override

- **WHEN** a host writes `.jeex-viewer .mode-button { … }` in an unlayered sheet
- **THEN** the mode buttons take those declarations

#### Scenario: Slot content

- **WHEN** a host places its own elements in a slot box
- **THEN** they receive the host's own rules and inherit from the slot box exactly as before

### Requirement: Strong host rules remain outside the protection

Anything heavier than the guard, such as two classes, attributes or pseudo-classes, an ID selector or `!important`, and declarations in the host's own cascade layers for properties the player's layers do not set, SHALL still apply to chrome elements, and the README SHALL state these limits.

#### Scenario: An important rule

- **WHEN** a host writes `button { padding: 20px !important }`
- **THEN** the chrome's buttons take that padding, as the README documents

### Requirement: The chrome's text has its own typography on both paths

On the light-DOM path and inside the custom element's shadow root, the chrome's text SHALL take its font family, size, weight, style, line height, letter and word spacing, text transform, indent, shadow, alignment, white-space handling and colour from the player, not from the page's `body`, `html` or the viewer root. Other inherited properties SHALL still pass through, and the root and slot boxes SHALL keep inheriting from the host.

#### Scenario: A hostile body around the custom element

- **WHEN** the page's `body` sets font size, weight, line height, letter and word spacing, text transform and alignment, and the viewer sits in a shadow root
- **THEN** the chrome's text computes the same values as without those body rules

#### Scenario: A hostile body around a light-DOM viewer

- **WHEN** the page's `body` sets `font: 300 18px/1.8 serif`, letter spacing and `text-align: center`, and the viewer is mounted with `mountViewer`
- **THEN** the chrome's text computes the same values as without those body rules

### Requirement: The shadow path keeps the page's rules out

Inside the custom element's shadow root, page rules SHALL still not reach the chrome, a sheet a host adds to that shadow root SHALL still win as before, and `::part()` rules SHALL still style the parts.

#### Scenario: A sheet inside the shadow root

- **WHEN** a host adds `button { padding: 13px 17px }` to the custom element's open shadow root
- **THEN** the chrome's buttons take that padding, as before this change
