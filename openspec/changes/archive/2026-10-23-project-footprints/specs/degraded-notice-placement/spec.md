## ADDED Requirements

### Requirement: The degraded notice stays clear of host boxes and the hint card

The degraded-asset notice SHALL sit at least 8 px above the top of every filled bottom host box (bottom-left, bottom-center, bottom-right) and of the visible hint card that it would otherwise overlap horizontally, and SHALL follow changes in their size and visibility while the viewer is mounted. Listeners and observers SHALL end with the viewer.

#### Scenario: Bottom-center host at phone size

- **WHEN** the viewer is 390 by 844 px, a host fills the bottom-center box and the notice is shown
- **THEN** the notice does not overlap the box or the hint card and is fully inside the viewer

#### Scenario: No host boxes at phone size

- **WHEN** the viewer is 390 by 844 px with no host boxes and the notice is shown
- **THEN** the notice does not overlap the hint card

#### Scenario: Both bottom corners claimed at phone size

- **WHEN** the viewer is 390 by 844 px, a host fills the bottom-left and bottom-right boxes and the notice is shown
- **THEN** the notice overlaps neither box nor the hint card and is fully inside the viewer

#### Scenario: Nothing in the way

- **WHEN** nothing overlaps the notice horizontally
- **THEN** it keeps its default bottom inset

#### Scenario: It follows a host box that grows and shrinks

- **WHEN** a filled bottom-center box grows, then empties
- **THEN** the notice rises to stay 8 px above it, then returns to its default inset

#### Scenario: It follows the hint card

- **WHEN** the hint card is hidden, or the tour bar appears and moves the hint card up
- **THEN** the notice drops back, or rises with the hint card

#### Scenario: It stops observing with the viewer

- **WHEN** the viewer's lifetime signal aborts
- **THEN** the observer is disconnected
