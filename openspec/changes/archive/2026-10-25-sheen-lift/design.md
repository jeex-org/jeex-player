# Design

The default lives where the sheen colour is set today, in `applyPhysical` of `library-material.ts`: `sheenColor.set(tint ?? white).lerp(white, SHEEN_LIFT)`. three converts the hex to linear on `set`, so the lerp runs in linear light, the same as the asset lab meters it. The lift is one exported constant rather than a material fact, because no material calls for a different value. Raising it costs boucle its specular cap, and lowering it loses the dark fabrics' grazing floor.
