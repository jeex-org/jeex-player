# viewer-settings-panel Specification

## Purpose
The viewer's general settings panel: the button beside the control bar that a host shows or hides, where it sits at every viewer width, how the panel opens, closes and is reached by keyboard and assistive technology, and the light temperature control it holds.

## Requirements

### Requirement: Settings button

The viewer SHALL show a settings button only when the host enables it (mount option `settings.show`, attribute `settings`, query parameter `settings`; off by default). The button SHALL sit as an extension attached to the control bar's end next to «Interior style»; the bar SHALL stay centred on its existing controls, so no existing control moves; on narrow viewers (600 px of viewer width or less) it SHALL sit directly under the bar's end, inside the viewer (the bar is at the top).

#### Scenario: Hidden by default
- **WHEN** a viewer mounts without `settings`
- **THEN** no settings button exists and the control bar is pixel-identical to the previous release

#### Scenario: Narrow viewer
- **WHEN** the viewer is 600 px wide or narrower
- **THEN** the settings button sits directly under the bar's end, inside the viewer

#### Scenario: Shown without moving controls
- **WHEN** a host enables the settings button
- **THEN** it appears next to «Interior style» and every existing control keeps its position, on both sides of the narrow breakpoint and for a narrow viewer inside a wide page

### Requirement: Settings panel

The settings button SHALL open a labelled, non-modal settings panel (a popover, a bottom sheet in narrow viewers) whose first setting is the light temperature: a labelled slider over the temperature range with its value read out (for example «3000 K · warm»), and a control that returns to «Original». All its strings SHALL exist in every shipped locale.

#### Scenario: Original first
- **WHEN** the panel opens on a viewer at «Original»
- **THEN** the slider's thumb rests at 4000 K, its read-out and value text say «Original», the reset control is unavailable, and the first adjustment sets 4000 ± 100 K and leaves «Original»

#### Scenario: Reopen
- **WHEN** the panel is closed and reopened
- **THEN** it shows the current value

### Requirement: Settings panel behaviour

The panel SHALL take initial focus on its slider, be operable by keyboard (Tab, arrows, Escape closes), report `aria-expanded`, close the «Interior style» panel when it opens and vice versa, close on a press outside it anywhere on the page (returning focus to its button only when the press is inside the viewer), keep the chrome awake while open, and SHALL NOT make the embedding page inert.

#### Scenario: Keyboard
- **WHEN** a keyboard user opens the panel, moves the slider with the arrow keys and presses Escape
- **THEN** the temperature changes in steps of 100 K, the panel closes and focus returns to the button

#### Scenario: Other states
- **WHEN** edits are off, «Interior style» is unavailable, or the chrome is hidden
- **THEN** the settings button stays available in the first two cases and hides with the chrome in the third, and the panel's strings follow a live locale change

#### Scenario: Accessible
- **WHEN** the panel is open
- **THEN** an automated accessibility check reports no violations and the slider has a translated value text

#### Scenario: Original
- **WHEN** the user chooses «Original»
- **THEN** the temperature becomes «Original» and the picture matches the default
