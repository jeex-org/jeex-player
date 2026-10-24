## MODIFIED Requirements

### Requirement: Settings button

The viewer SHALL show a settings button only when the host enables it (mount option `settings.show`, attribute `settings`, query parameter `settings`; off by default). The button SHALL sit as an extension attached to the control bar's chosen side (`settings.side`, see «Settings side»): by default the bar's end, next to «Interior style». The bar SHALL stay centred on its existing controls, so no existing control moves; on narrow viewers (600 px of viewer width or less) the button SHALL sit directly under the bar's chosen side, inside the viewer (the bar is at the top).

#### Scenario: Hidden by default
- **WHEN** a viewer mounts without `settings`
- **THEN** no settings button exists and the control bar is pixel-identical to the previous release

#### Scenario: Narrow viewer
- **WHEN** the viewer is 600 px wide or narrower
- **THEN** the settings button sits directly under the bar's chosen side, inside the viewer

#### Scenario: Shown without moving controls
- **WHEN** a host enables the settings button
- **THEN** it appears attached to the bar's chosen side and every existing control keeps its position, on both sides of the narrow breakpoint and for a narrow viewer inside a wide page

## ADDED Requirements

### Requirement: Settings side

The host SHALL choose the control bar edge the settings button attaches to with `settings.side` (attribute `settings-side`, query parameter `settingsSide`): `'end'` (the default) or `'start'`, the bar's inline edges by its computed writing direction. The side SHALL be read once at mount. With `'end'` the button, its panel and the keyboard order SHALL be exactly as without the option.

#### Scenario: Start is the left in a left-to-right bar
- **WHEN** a viewer in any shipped locale mounts with `settings.side: 'start'`
- **THEN** the button attaches to the bar's left edge

#### Scenario: Invalid value
- **WHEN** the attribute or the query parameter carries a value other than `start` or `end`
- **THEN** the viewer keeps `'end'` and warns once

#### Scenario: Default end
- **WHEN** a viewer mounts with `settings` and no side, or with `settings-side="end"`
- **THEN** the button, the panel and the control bar are pixel-identical to the previous release

#### Scenario: Set through the query and the attribute
- **WHEN** a page uses the query parameter `settingsSide=start`, or an element carries `settings-side="start"`
- **THEN** the button sits on the bar's start, and an automated accessibility check reports no violations

#### Scenario: Read once
- **WHEN** the `settings-side` attribute changes after the viewer mounted
- **THEN** the viewer warns once and the button stays where it is

### Requirement: Start-side placement

With `settings.side: 'start'` the button SHALL sit beside the bar's start with the same gap as at the end, or directly under the bar's start when the viewer is 600 px wide or narrower or when it does not fit beside the bar with 8 px to spare inside the viewer. The open panel SHALL sit under the button with its start edge on the button's start edge, inside the viewer, and stay a bottom sheet at 430 px of viewer width or less. The button SHALL come before the bar's controls in keyboard order.

#### Scenario: Start beside the bar
- **WHEN** a viewer 1280 px wide mounts with `settings` and `settings.side: 'start'`
- **THEN** the button sits beside the bar's start with a 4 px gap, centred on the bar's height, and no existing control moves

#### Scenario: Start under the bar
- **WHEN** the viewer is 600 px wide or narrower, or a long scene name leaves no room beside the bar's start
- **THEN** the button sits directly under the bar's start, inside the viewer

#### Scenario: Start panel inside the viewer
- **WHEN** the panel opens from a start-side button, and when the viewer is then resized
- **THEN** the panel's start edge is on the button's start edge, the panel stays inside the viewer and follows the button, and at 430 px or narrower it is the bottom sheet

#### Scenario: Keyboard order on the start side
- **WHEN** a keyboard user tabs through the bar with the button on the start side
- **THEN** the settings button comes before the bar's first control, Shift+Tab goes back the same way, and Escape closes the panel with focus on the button
