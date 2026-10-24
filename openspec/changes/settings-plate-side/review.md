# Independent review

## Reviewer

An independent agent that did not write the artifacts, one round (Sol round), verdict «go with changes». The author accepted all six findings and amended the artifacts; no re-review was needed.

## Findings

1. design.md: the bottom-sheet rule at 430 px could not override the proposed `[data-anchor='left']` panel rule (lower specificity). Fixed: an override of equal or higher specificity inside the 430 px query restores all four sheet insets; a resize across 430 px in both directions is specified and tested (spec scenario «Bottom sheet on both sides», task 2.1).
2. tasks.md: `barLayout()` in the component suite keys unnamed mode buttons by position, so a prepended plate shifts the keys and breaks the «no control moves» comparison. Fixed: task 2.1 first keys mode buttons by `data-mode` and skips the settings button.
3. spec.md: button-edge alignment was required unconditionally, including in the bottom sheet. Fixed: above 430 px the panel aligns where it fits, otherwise clamps inside the viewer; at 430 px or less the sheet geometry is independent of the button; separate scenarios and separate assertions in task 2.1.
4. spec.md, design.md: direction-dependent guarantees assumed left-to-right; a shipped locale does not prevent an inherited `rtl`. Fixed: computed `direction: ltr` is the stated precondition of «start is left» and of the pixel-identical default; a right-to-left scenario and RTL checks for both sides were added (task 2.1).
5. spec.md: the new scenarios implied that the side alone creates a button. Fixed: every scenario enables `settings` explicitly, and a «Side alone» scenario keeps the off-by-default contract.
6. tasks.md: the e2e shadow-root case used a Playwright pointer click, which stalls on software rendering. Fixed: task 3.1 uses an evaluated DOM click or keyboard activation and keeps the visibility and in-viewer geometry assertions.

## Verdict

Ready for implementation: yes
