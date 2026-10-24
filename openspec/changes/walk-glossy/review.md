# Independent review

## Reviewer

An independent second agent that did not write the artifacts, read-only, one round (Sol round). Verdict of the round: go with changes. All seven findings were accepted and the artifacts amended; no re-review round was needed.

## Findings

1. design (calibration): a byte read-back under linear tone mapping is still sRGB-encoded by the output pass, so dividing by a fraction of the walk exposure is wrong; the temperature equivalence of the band is unnecessary. Verdict: fixed. Metering is in the linear domain (the half-float buffer, or bytes decoded with the sRGB EOTF and divided by the exposure actually set), domain and exposure recorded; the band is the plain acceptance target R/B 1.3–1.6.
2. white-balance spec and design (luminance): `M' = M + u(y − yM)` preserves luminance exactly, but the clamp at zero raises the luminance of a colour it clips (about 23 % for pure blue at source (2, 1.5, 1), degree 0.5). Verdict: fixed. Exact preservation is promised before the clamp; the on-screen tolerance stays on neutral patches and view means; expected output values include the clamp.
3. design and white-balance spec (panoramas): leaving panoramas unbalanced keeps exactly the cast being corrected and breaks the promise that a panorama and a still are one picture. Verdict: fixed. A panorama's display pass in walk and tour applies the chain's matrix before tone mapping; its cube faces stay unbalanced and its direct path stays; a matched neutral-patch comparison with a still is added.
4. room-lighting delta (placement wording): «the point farthest» promised a continuous optimum the lattice search does not give; the fallback order was not explicit; the lamp scenarios' 0.5 m needs a qualifying candidate. Verdict: fixed. The requirement names the bounded lattice candidates, the score with its centre bias, the fallback order (min of furniture clearance and edge distance, then score, then traversal order) and conditions the scenarios on a qualifying candidate.
5. tasks (refresh coverage): missing checks for another room's moved probe joining the re-capture, an edit during the initial bake restarting with current positions, a changed projection box reloading, a display draw then rest after the refresh, and refresh with a host sky installed. Verdict: fixed. Scenarios and tasks 2.3, 2.4 and 2.6 added; the host-sky test (2.6) runs after the rebase onto a main that contains the host sky, since that work is not on main yet.
6. room-lighting delta and tasks (gloss proof): the 2.5× threshold must be scoped to the demo living-room fixture with recorded pose, resolution, floor mask and linear specular luminance; the window proof must use the same black, non-metal, map-free floor; GPU measurements must assert a hardware renderer. Verdict: fixed.
7. post-processing delta: «the chain has no other pass» contradicted the existing chain; the mirror's direct-path brightness comparison needs the identity white balance. Verdict: fixed. The scenario reads «the white balance adds no pass and no render target»; «Mirrors under the chain» and «Captures in walk and tour» are carried as MODIFIED requirements.

8. Walk emissive cap (shades blown out in walk): added by jeex-common after the Sol round; spec requirement «Emissive surfaces in walk and tour», design decision 6, tasks group 6.

## Verdict

Ready for implementation: yes
