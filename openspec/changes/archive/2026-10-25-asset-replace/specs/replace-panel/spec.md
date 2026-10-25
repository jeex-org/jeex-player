## ADDED Requirements

### Requirement: Every variant reachable

The Replace panel SHALL list every variant of the selected asset. Its variant region SHALL scroll within a height bounded by the viewer, with the title and the footer buttons visible.

#### Scenario: Many variants on a phone
- **WHEN** an offers asset with 20 variants is selected in a 390×700 viewer
- **THEN** the panel stays inside the viewer and the last variant can be scrolled to and picked

### Requirement: Replace with another asset

Below the existing footer button the Replace panel SHALL show a "Replace with another…" button. It SHALL open a popup with a visible title listing the assets of `offers`, or of the bundled bank without it, that `replace_asset` would accept for the selection, excluding its own archetype, grouped by the top segment of the category path, with an empty state when none qualify. Picking one SHALL commit `replace_asset` naming the offered default variant, and close the popup.

#### Scenario: Floor sofa
- **WHEN** a floor sofa is selected and the button is pressed
- **THEN** the popup lists only floor assets, grouped by category, without the sofa's own design

#### Scenario: Mirrored sofa
- **WHEN** a sofa mirrored on x is selected
- **THEN** the popup lists no asset whose mirror facts forbid x

#### Scenario: Bundled bank alone
- **WHEN** a floor sofa is selected in a scene without `offers`
- **THEN** the popup lists the bundled floor assets with rendered previews under one readable heading per top-level category (Furniture, Lighting, Sanitary, Appliances, Decor)

#### Scenario: Nothing to offer
- **WHEN** no offered asset shares the anchor
- **THEN** the popup shows its empty state

### Requirement: Popup works with a keyboard and on a phone

The popup SHALL be modal within the viewer: Tab stays inside it, Escape and its close button close it, and focus returns to the button that opened it. It SHALL fit a 390-pixel-wide viewer without horizontal scrolling. The existing panel controls SHALL keep their positions.

#### Scenario: Keyboard
- **WHEN** the popup is opened with Enter, Tabbed through and closed with Escape
- **THEN** focus never leaves the popup while it is open, and returns to the button afterwards
