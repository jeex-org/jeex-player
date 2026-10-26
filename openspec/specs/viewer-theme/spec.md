# viewer-theme Specification

## Purpose
How a host themes the viewer through CSS custom properties on its root: the WebGL backdrop and the mini-map, which CSS cannot paint, follow those properties too, a live change is picked up with `refreshTheme()`, and without a host theme the viewer stays neutral.

## Requirements

### Requirement: The 3D backdrop follows the host's CSS

At mount, before the first frame, the viewer SHALL resolve `--jeex-backdrop` (horizon) and `--jeex-backdrop-top` (default: the horizon mixed with 8% white) on its root to opaque colours, and SHALL draw the fallback sky gradient and fog from them. A value that is not a colour SHALL fall back to the neutral default. In 360 and the 3D plan the site ground SHALL show only the model's shadow over that sky.

#### Scenario: Host sets a graphite backdrop
- **WHEN** the host sets `--jeex-backdrop: #20242a` on the root
- **THEN** in 360 the pixels around the model and the CSS background before the first frame are that colour, and the fog colour is the horizon

### Requirement: Live theme refresh

`refreshTheme()` on the handle SHALL re-read the theme and apply a changed backdrop without remounting. A refresh during walk or tour SHALL leave the HDRI sky in place and SHALL show the new backdrop on return to 360. The previous sky texture SHALL be disposed, and another viewer's sky SHALL be untouched.

#### Scenario: Theme switched in walk
- **WHEN** the host changes `--jeex-backdrop` while in walk and calls `refreshTheme()`
- **THEN** walk keeps its HDRI sky, and 360 shows the new backdrop afterwards

### Requirement: Walk, tour and camera views keep the daylight sky

Without an HDRI, walk and tour SHALL show and light the rooms from the fixed daylight sky, never the host's backdrop; a backdrop set meanwhile SHALL be kept and shown on return to 360 or plan. A still from a room, tour or scene camera, a panorama and tour frames SHALL show that sky too, from any mode; a still of the live view SHALL show the sky on screen.

#### Scenario: Room panorama from 360 under a dark backdrop
- **WHEN** the host's backdrop is dark and a panorama of a room is taken in 360
- **THEN** the windows show the daylight sky, and 360 shows the dark backdrop again once it is done

### Requirement: Accent drives its companions

`--jeex-accent-strong` and `--jeex-accent-muted` SHALL derive from `--jeex-accent` with `color-mix()`, and `--jeex-focus` SHALL default to the accent, so overriding the accent alone recolours the mode pill, hint icon, loading marks and track, tour knob, focus ring and the mini-map's view cone and camera dot. `--jeex-on-accent` SHALL be a documented override.

#### Scenario: Blue accent
- **WHEN** the host sets only `--jeex-accent: #4f8cff`
- **THEN** no chrome element still paints the former gold

### Requirement: Neutral defaults and a state surface

The package defaults SHALL be neutral graphite (accent, backdrop, surfaces, text), and the loading and error cards SHALL paint `--jeex-state-surface` (default: the surface) instead of a fixed gradient. The player site SHALL keep its warm look by setting the properties in its demo frame.

#### Scenario: Default embed
- **WHEN** a page embeds the viewer with no theme properties
- **THEN** the backdrop, cards and accent are neutral, with no beige or gold
