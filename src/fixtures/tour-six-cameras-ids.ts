/**
 * Ids of the six tour cameras of `tour-six-cameras.ts`.
 *
 * Every id in a scene is a UUID v7 and the viewer never mints one, so a
 * fixture's ids are fixed literals generated once, offline. Each key is the
 * camel-cased readable name of the entity, so a test reads
 * `SIX_CAMERAS.kitchen` for the camera called `c-kitchen`.
 */

export const SIX_CAMERAS = {
  living: '01a12fe6-aef0-7e7a-9af1-aa3a9b90fe74',
  kitchen: '01a12fe6-aef1-7a9f-b9ca-7c766488bddb',
  hall: '01a12fe6-aef2-74a1-811f-7374dd33ff02',
  bed: '01a12fe6-aef3-7420-a4d2-0edfd8e1a0b5',
  room: '01a12fe6-aef4-71b0-a1a1-47f62d0c8f34',
  guest: '01a12fe6-aef5-7323-ae8c-ed37d02b47f2',
} as const;
