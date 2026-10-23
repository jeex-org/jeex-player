/**
 * A project library of room finishes, as the scene layer reads it: library
 * materials for every surface word, one material of each legacy member, and
 * the registries the shipped catalogues give with that library in front.
 *
 * What the finish-value tests (validator, `set_material`, presets, remap) all
 * need, kept in one place so each rule is judged against the same table. The
 * ids are fixed literals generated once, offline; the viewer never mints one.
 */

import { CATALOGUE_REGISTRIES } from '../assets/catalogue-registries.js';
import { registriesFromLibrary, type ProjectLibrary, type SceneRegistries } from '../scene/registries.js';

export const LIBRARY_FINISH = {
  /** The project, whose library these materials are. */
  project: '01a167f6-0409-7047-b2b7-9297ca140b6a',
  /** A library scan for floors. */
  floorScan: '01a167f6-0409-7db4-97bc-9dda7c1d1083',
  /** A tintable library paint for walls, ceilings, the facade and trim. */
  paint: '01a167f6-0409-764e-8fab-610e8901843d',
  /** A library material that dresses both floors and walls. */
  floorAndWall: '01a167f6-0409-79fc-94c0-e0d63b0828c5',
  /** A library material for the facade alone. */
  facadeOnly: '01a167f6-0409-7fd7-aab1-b82e267f361c',
  /** A library material for the facade and walls. */
  facadeAndWall: '01a167f6-0409-7651-8beb-c8cd3ec8cdc9',
  /** A library material that dresses walls only. */
  wallOnly: '01a167f6-040a-7ad9-9a56-71b82ea61241',
  /** A legacy `pbr` project material for walls. */
  pbrWall: '01a167f6-040a-77ed-ba36-7e1d04257849',
  /** A legacy `generator` project material for floors. */
  generatorFloor: '01a167f6-040a-7928-8f0d-8d7c4ca4b09e',
  /** A library material for furniture only: no room surface at all. */
  fabric: '01a167f6-040a-79ce-bc87-4a57db01e8b3',
} as const;

/** The library as `projectLibraryOf` would hand it over: ids, `apply`, and which member draws each. */
export const LIBRARY_PROJECT: ProjectLibrary = {
  id: LIBRARY_FINISH.project,
  objects: [],
  materials: [
    { id: LIBRARY_FINISH.floorScan, apply: ['floor'], library: true },
    { id: LIBRARY_FINISH.paint, apply: ['wall', 'ceiling', 'facade', 'trim'], library: true },
    { id: LIBRARY_FINISH.floorAndWall, apply: ['floor', 'wall'], library: true },
    { id: LIBRARY_FINISH.facadeOnly, apply: ['facade'], library: true },
    { id: LIBRARY_FINISH.facadeAndWall, apply: ['facade', 'wall'], library: true },
    { id: LIBRARY_FINISH.wallOnly, apply: ['wall'], library: true },
    { id: LIBRARY_FINISH.pbrWall, apply: ['wall'] },
    { id: LIBRARY_FINISH.generatorFloor, apply: ['floor'] },
    { id: LIBRARY_FINISH.fabric, apply: ['fabric'], library: true },
  ],
};

/** The shipped registries with the library in front: a document may mix its finishes with bundled ones. */
export const LIBRARY_REGISTRIES: SceneRegistries = registriesFromLibrary(LIBRARY_PROJECT, CATALOGUE_REGISTRIES);
