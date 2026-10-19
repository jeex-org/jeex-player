/**
 * Ids of the editor scenario of `editor-scenario.ts`: the empty shell and the
 * project library it is furnished from.
 *
 * Every id in a scene is a UUID v7 and the viewer never mints one, so a
 * fixture's ids are fixed literals generated once, offline. Each key is the
 * camel-cased readable name of the entity, so a test reads
 * `EDITOR.room.space` for the room called `space`.
 */

export const EDITOR = {
  scene: '01a12fe6-aef6-7059-bd15-d9154db5a42f',
  /** The four corners. */
  node: {
    cNw: '01a12fe6-aef7-7f4d-82f1-e536ec7666dd',
    cNe: '01a12fe6-aef8-70e4-af65-6f915cb72ec7',
    cSe: '01a12fe6-aef9-71f0-8fd2-c73586727250',
    cSw: '01a12fe6-aefa-71b9-afec-8a1fc1e34d7f',
  },
  /** The four walls. */
  wall: {
    wallN: '01a12fe6-aefb-7123-b7d4-c9e954a7ccff',
    wallE: '01a12fe6-aefc-711d-b782-15a73934e306',
    wallS: '01a12fe6-aefd-7103-9923-79f2c3c11cbf',
    wallW: '01a12fe6-aefe-779b-9edf-c6e4f3207aa5',
  },
  /** The one room. */
  room: {
    space: '01a12fe6-aeff-7133-aee6-a1ae90eb681a',
  },
  /** The project's own library; its id is the project's UUID (manifest format 2). */
  library: {
    project: '01a12fe6-af00-7f19-b350-fcd79cad26da',
    /** Archetypes. */
    object: {
      sofaLib: '01a12fe6-af01-7afa-b7e3-0aa344a27a36',
      tableLib: '01a12fe6-af02-7266-ac11-60c93d4cb321',
      sconceLib: '01a12fe6-af03-7d05-9c63-a14d669268e7',
    },
    /** Variants. */
    variant: {
      sofaLibLinen: '01a12fe6-af04-7a2e-b1f7-f2db924167b5',
      sofaLibWool: '01a12fe6-af05-7c08-905b-f42cd0909f42',
      tableLibOak: '01a12fe6-af06-729c-be5c-37e786b844ed',
      sconceLibBrass: '01a12fe6-af07-7c53-80c2-9a543e942267',
    },
    /** Finishes the library ships. */
    material: {
      libOak: '01a12fe6-af08-7a17-967c-768acf8728ff',
      libTerrazzo: '01a12fe6-af09-73cb-9840-78d42afb67c5',
      libChalk: '01a12fe6-af0a-73d7-88b7-ad8958f5fa0f',
      libLinen: '01a12fe6-af0b-7df9-a682-67884aa19bdc',
    },
  },
} as const;
