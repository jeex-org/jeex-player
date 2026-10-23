# Spec Delta

## Purpose

Keeps the viewer chrome looking like itself when the viewer is mounted into a host page whose own global CSS styles buttons, text, icons and images, while every documented host styling hook keeps working.

## ADDED Requirements

### Requirement: Generic host rules do not reach the chrome on the light-DOM path

When the viewer is mounted into the host document's light DOM, UNLAYERED host rules made of element names, the universal selector, and at most one class, attribute or pseudo-class with one element name SHALL NOT change the size, position or computed look of any chrome element below the viewer root, and inherited host typography SHALL NOT reach chrome text. The root's own box stays the host's to size.

#### Scenario: A page with aggressive global CSS

- **WHEN** a viewer is mounted with `mountViewer` into a page whose unlayered sheet resets `*`, sets body typography, and styles `button`, `select`, `input`, `a`, `svg`, `img`, `span`, `p` and `label`, plus `.site-content button`
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

Host rules with two or more classes, attributes or pseudo-classes, an ID selector, or `!important`, and declarations in the host's own cascade layers for properties the player's layers do not set, SHALL still apply to chrome elements, and the README SHALL state these limits.

#### Scenario: An important rule

- **WHEN** a host writes `button { padding: 20px !important }`
- **THEN** the chrome's buttons take that padding, as the README documents

### Requirement: The shadow path is unchanged

The custom element's chrome inside its shadow root SHALL compute exactly what it computed before this change.

#### Scenario: Existing element baseline

- **WHEN** the custom-element page is photographed
- **THEN** it matches its existing chrome baseline
