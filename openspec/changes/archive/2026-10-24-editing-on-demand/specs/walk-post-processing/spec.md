# Spec Delta: walk-post-processing

## MODIFIED Requirements

### Requirement: Active only in walk and tour

The player SHALL render through the post-processing chain while the camera mode is `walk` or `tour`, in every shell state those modes use, and SHALL render straight to the screen in every other mode. In walk and tour, a display draw (requirement «Redraw on demand in walk and tour») renders the beauty pass once and the occlusion input once; editing modes draw on their own schedule (capability `render-loop`: on demand in `orbit` and `plan3d`, the low-rate heartbeat in `plan2d`).

#### Scenario: Editing modes unchanged
- **WHEN** the camera mode is `plan2d`, `plan3d` or `orbit`
- **THEN** every display draw renders directly to the default framebuffer as before, and no post-processing pass runs

#### Scenario: Walk uses the chain
- **WHEN** the viewer makes a display draw in `walk` after the chain has loaded
- **THEN** that draw renders the beauty pass once and its occlusion input once, and the chain writes the screen

#### Scenario: Tour from the overview
- **WHEN** a tour starts in its overview (dollhouse) shell
- **THEN** the chain is active from the first display draw after it has loaded
