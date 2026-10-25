# orbit-selection Specification

## Purpose
How taps in 360 select and deselect furniture and openings in the viewer's built-in editor, and which gestures (drags, double taps, walk taps, the host's move tool) never count as a second tap.

## Requirements

### Requirement: A second tap deselects in 360

In `orbit` with the built-in editor on, a tap on the furniture item or opening that carries the selection aura SHALL clear the selection and close its panel. A tap on a different furniture item or opening SHALL select it instead.

#### Scenario: Second tap on the selected sofa
- **WHEN** a sofa is selected and the user taps it again
- **THEN** the aura fades out, the Replace panel is closed and nothing is selected

#### Scenario: Tap on another object
- **WHEN** a sofa is selected and the user taps an armchair
- **THEN** the armchair is selected and its panel opens

#### Scenario: Door button
- **WHEN** a door is selected and the user taps its open/close button
- **THEN** the door opens or closes and stays selected; a tap on the door away from the button deselects it, and raises the button again

#### Scenario: Third tap
- **WHEN** a sofa was deselected by a second tap and is tapped again
- **THEN** it is selected again

### Requirement: Gestures that are not a second tap

A drag in 360 SHALL NOT change the selection. The 360 selection SHALL ignore the second click of a double click or double tap, so a second tap faster than the double-click interval counts as a double tap. A tap in `walk` SHALL walk as before. With the host's asset move tool on, a press on the highlighted object belongs to the tool and SHALL NOT deselect.

#### Scenario: Drag to look
- **WHEN** a sofa is selected and the user drags across it to turn the view
- **THEN** the sofa stays selected

#### Scenario: Double tap on an unselected object
- **WHEN** the user double-taps an unselected armchair
- **THEN** the armchair is selected once and the camera flies in

#### Scenario: Double tap on the selected object
- **WHEN** the user double-taps the selected sofa
- **THEN** the sofa is deselected and the camera flies in

#### Scenario: Walk tap
- **WHEN** the user taps the floor in walk, then taps again
- **THEN** the walker travels and the second tap speeds it up
