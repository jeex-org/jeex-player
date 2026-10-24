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

The host SHALL choose the control bar edge the settings button attaches to with `settings.side` (attribute `settings-side`, query parameter `settingsSide`): `'end'` (the default) or `'start'`, the bar's inline edges by its computed writing direction. The side SHALL be read once at mount and SHALL NOT create a button on its own: without `settings` there is none. In a left-to-right bar, `'end'` SHALL keep the button, its panel and the keyboard order exactly as without the option.

#### Scenario: Start is the left in a left-to-right bar
- **WHEN** a viewer whose control bar computes `direction: ltr` mounts with `settings` and `settings.side: 'start'`
- **THEN** the button attaches to the bar's left edge

#### Scenario: Right-to-left bar
- **WHEN** the control bar computes `direction: rtl` (for example inherited from the host page)
- **THEN** `'start'` attaches the button to the bar's right edge and `'end'` to its left edge, and the plate and an open panel stay inside the viewer

#### Scenario: Side alone
- **WHEN** a viewer mounts with `settings.side: 'start'` or `settings-side="start"` but without `settings`
- **THEN** no settings button exists

#### Scenario: Invalid value
- **WHEN** the attribute or the query parameter carries a value other than `start` or `end`
- **THEN** the viewer keeps `'end'` and warns once

#### Scenario: Default end
- **WHEN** a viewer whose control bar computes `direction: ltr` mounts with `settings` and no side, or with `settings` and `settings-side="end"`
- **THEN** the button, the panel and the control bar are pixel-identical to the previous release

#### Scenario: Set through the query and the attribute
- **WHEN** a page uses the query parameters `settings` and `settingsSide=start`, or an element carries `settings` and `settings-side="start"`
- **THEN** the button sits on the bar's start, and an automated accessibility check reports no violations

#### Scenario: Read once
- **WHEN** the `settings-side` attribute changes after the viewer mounted
- **THEN** the viewer warns once and the button stays where it is

### Requirement: Start-side placement

With `settings.side: 'start'` the button SHALL sit beside the bar's start with the same gap as at the end, or directly under it at 600 px of viewer width or less or when it does not fit beside with 8 px to spare. Above 430 px the open panel SHALL align its start edge with the button's where that fits, otherwise clamp inside the viewer; at 430 px or less it SHALL be the existing bottom sheet, independent of the button and the side. The button SHALL come first in the bar's keyboard order.

#### Scenario: Start beside the bar
- **WHEN** a viewer 1280 px wide mounts with `settings` and `settings.side: 'start'`
- **THEN** the button sits beside the bar's start with a 4 px gap, centred on the bar's height, and no existing control moves

#### Scenario: Start under the bar
- **WHEN** the viewer is 600 px wide or narrower, or a long scene name leaves no room beside the bar's start
- **THEN** the button sits directly under the bar's start, inside the viewer

#### Scenario: Start panel as a popover
- **WHEN** the panel opens from a start-side button in a viewer wider than 430 px, and when the viewer is then resized above 430 px
- **THEN** the panel's start edge is on the button's start edge where it fits, otherwise the panel is clamped inside the viewer, and it follows the button

#### Scenario: Bottom sheet on both sides
- **WHEN** the panel is open on either side and the viewer is resized across 430 px in either direction
- **THEN** at 430 px or narrower it has the bottom sheet's geometry, the same for both sides, and above 430 px it is the popover again

#### Scenario: Keyboard order on the start side
- **WHEN** a keyboard user tabs through the bar with the button on the start side
- **THEN** the settings button comes before the bar's first control, Shift+Tab goes back the same way, and Escape closes the panel with focus on the button
