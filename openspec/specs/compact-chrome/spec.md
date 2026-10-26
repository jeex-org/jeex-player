# compact-chrome Specification

## Purpose
How the viewer's own chrome stays out of the way on a small canvas: the controls hint folds to one button on a narrow viewer, and the reveal button never overlaps the control bar while it fades.

## Requirements

### Requirement: Compact hint on narrow canvases

Below a 480 px container width, the hint text SHALL be hidden behind a toggle button (`aria-expanded`) beside the icon. Activating it SHALL expand the text; the first camera gesture SHALL collapse it, whatever the auto-hide setting, and pointer movement SHALL NOT. At 480 px and wider, the hint SHALL be unchanged.

#### Scenario: Demo hero
- **WHEN** the viewer is 350 × 197 px (the 16:9 hero at a 390 px phone width) in 360
- **THEN** the hint shows only its icon, and a tap shows the full text

### Requirement: The reveal button never overlaps the fading bar

When the control bar auto-hides, the "•••" reveal button SHALL start to appear only after the bar's fade-out has finished, and SHALL disappear without delay when the bar returns, so the two are never visible at the same time.

#### Scenario: Auto-hide on the demo hero
- **WHEN** the control bar of a 350 × 197 px viewer auto-hides
- **THEN** the reveal button fades in after the bar has gone, never on top of it
