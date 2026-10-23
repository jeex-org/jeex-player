# Independent review

## Reviewer

An independent agent that did not write the artifacts, read-only, two rounds (Sol unavailable until 19:43, Opus rounds); round 1: 3 blockers, 6 should-fix, 3 nits; round 2: all resolved, nits only.

## Findings

1. brainstorm: `compile` collects materials from the whole scene, not visible objects only: fixed.
2. spec / tasks: program keys depend on the bound render target; the chain needs its own compile with its read buffer bound before attach; a start in tour: fixed (task 2.4, «Start in tour» scenario).
3. tasks: the chain's full-screen materials: fixed (measured first; compiled only above 16 ms of link time).
4. spec: `ready`, the app-ready flag and the reveal fired before the deferred first draw: fixed (requirement «Ready after the first picture», a first-draw signal on the runtime, test audit).
5. spec: the bound had no value; rejection, throw and missing `compileAsync`: fixed (1 s; draw at once).
6. spec / tasks: acceptance measurement undefined: fixed (profile self time of program-status queries; extension stubbed for the no-parallel case).
7. brainstorm: grid program re-link: accepted and measured.
8. tasks: file limits: fixed (helpers move out, not `hasWebGL`).
9. tasks: interaction with draw-on-demand: fixed (gate before the demand gate, commits nothing, armed on `start()`).
10. tasks: screenshot tolerance: fixed.
11. proposal: captures before compilation resolves: stated as accepted.
12. tasks: heavy queue in 3.2: fixed. Round 2 nits (10 ms resolve, «the scene», `ready` listed as a behaviour change): fixed.

## Verdict

Ready for implementation: yes
