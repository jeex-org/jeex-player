## ADDED Requirements

### Requirement: Settings button

The viewer SHALL show a settings button only when the host enables it (mount option `settings.show`, attribute `settings`, query parameter `settings`; off by default). The button SHALL sit as an extension attached to the control bar's end next to «Interior style»; the bar SHALL stay centred on its existing controls, so no existing control moves; on narrow viewers it SHALL follow the bar's narrow-screen rule.

#### Scenario: Hidden by default
- **WHEN** a viewer mounts without `settings`
- **THEN** no settings button exists and the control bar is pixel-identical to the previous release

#### Scenario: Shown without moving controls
- **WHEN** a host enables the settings button
- **THEN** it appears next to «Interior style» and every existing control keeps its position

### Requirement: Settings panel

The settings button SHALL open a labelled, non-modal settings panel (a popover, a bottom sheet in narrow viewers) whose first setting is the light temperature: a labelled slider over the temperature range with its value read out (for example «3000 K · warm»), and a control that returns to «Original». All its strings SHALL exist in every shipped locale.

#### Scenario: Original first
- **WHEN** the panel opens on a viewer at «Original»
- **THEN** the slider shows «Original» and the reset control is unavailable

### Requirement: Settings panel behaviour

The panel SHALL be operable by keyboard (Tab, arrows on the slider, Escape closes), SHALL report its state with `aria-expanded`, SHALL return focus to the button on close, SHALL close on an outside press, SHALL keep the chrome awake while open and SHALL NOT make the embedding page inert.

#### Scenario: Keyboard
- **WHEN** a keyboard user opens the panel, moves the slider with the arrow keys and presses Escape
- **THEN** the temperature changes in steps of 100 K, the panel closes and focus returns to the button

#### Scenario: Accessible
- **WHEN** the panel is open
- **THEN** an automated accessibility check reports no violations and the slider has a translated value text

#### Scenario: Original
- **WHEN** the user chooses «Original»
- **THEN** the temperature becomes «Original» and the picture matches the default
