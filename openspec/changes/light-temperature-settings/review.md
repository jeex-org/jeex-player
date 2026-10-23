# Independent review

## Reviewer

The independent partner, read-only, two rounds (round 1: 3 blockers, 7 should-fix; round 2: 9 resolved, 1 partly).

## Findings

1. spec: «Original» identity contradicted the walk sun factor: fixed (artificial-light colours restored exactly; the sun factor is separate; editing frames pixel-identical).
2. design: the assumed lamp tag did not exist: fixed (tag added to the three bank builders, applied on new roots, swaps and default-state capture scenes, tested with the real builders).
3. spec: public contract shapes and invalid-input behaviour undefined: fixed (state field, event payload, element event, iframe command and event, invalid input keeps the current value, removal, no event on unchanged); round 2 leftover (event spelled differently in design, proposal and brainstorm; iframe event key ambiguous) fixed: `lightTemperature` everywhere, iframe event key `lightTemperature`.
4. spec: the range input cannot hold «Original»: fixed (thumb at 4000 K, first adjustment leaves «Original», value text, reopen).
5. design: no narrow-screen wrap rule exists: fixed (under the bar's end inside the viewer by container query at 600 px or less, decided at implementation; both sides and a narrow viewer in a wide page tested).
6. spec: panel integration: fixed (initial focus, mutual exclusion, document-wide dismissal, focus return rules, edits off, unavailable «Interior style», hidden chrome, live locale).
7. design: probe refresh budget: fixed (one room per frame after a 250 ms settle, in place, gate invalidated, grids untouched).
8. spec: walk ratios and floor metric: fixed (published ranges, 64 × 64 px region, luminance deviation, shader anchor, identity, lamps unaffected).
9. tasks: captures: fixed (live and default-state stills, panorama).
10. tasks: verification gaps: fixed (cost table, surface tests, consumer fixture, test-first schema, extraction first, heavy queue, luminance tolerance).

## Verdict

Ready for implementation: yes
