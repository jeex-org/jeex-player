/**
 * The three-camera flat the tour-route defects were reproduced on, saved
 * verbatim so the route tests ride the very document that showed them —
 * verbatim but for its ids, which are UUIDs
 * (`tour-three-cameras-ids.ts`, keyed by readable names).
 *
 * Two rooms split by a 0.10 partition at x = 4 with one inner door
 * (`OPENING.oDoorInner`, z 2.15..3.05); `cam1` stands in the bedroom, `cam3`
 * and `cam2` in the living room, so the first leg MUST pass the doorway. The cameras look
 * down steeply (-21° to -46°): a gaze point six metres ahead of them lay under
 * the floor.
 */

import { ARCHETYPE, OPENING_VARIANT, VARIANT } from '../assets/catalogue-ids.js';
import { FINISH } from '../materials/finish-ids.js';
import type { SceneData } from '../scene/types.js';
import { THREE_CAMERAS } from './tour-three-cameras-ids.js';

const { node: NODE, wall: WALL, opening: OPENING, room: ROOM, asset: ASSET, checkpoint: CHECKPOINT } = THREE_CAMERAS;

export const threeCameraTour: SceneData = {
  schemaVersion: '2.2',
  units: 'm',
  id: THREE_CAMERAS.scene,
  name: 'Three-camera tour',
  ceilingHeight: 2.7,
  nodes: [
    {
      id: NODE.nSw,
      p: {
        x: 0,
        z: 0,
      },
    },
    {
      id: NODE.nSplit,
      p: {
        x: 4,
        z: 0,
      },
    },
    {
      id: NODE.nSe,
      p: {
        x: 8,
        z: 0,
      },
    },
    {
      id: NODE.nNe,
      p: {
        x: 8,
        z: 5,
      },
    },
    {
      id: NODE.nNsplit,
      p: {
        x: 4,
        z: 5,
      },
    },
    {
      id: NODE.nNw,
      p: {
        x: 0,
        z: 5,
      },
    },
  ],
  walls: [
    {
      id: WALL.wLivingSouth,
      a: NODE.nSw,
      b: NODE.nSplit,
      thickness: 0.3,
      role: 'facade',
      openings: [
        {
          id: OPENING.oEntrance,
          type: 'door',
          entrance: true,
          center: 1.2,
          width: 1,
          sill: 0,
          head: 2.1,
          variant: OPENING_VARIANT.entry_door_walnut_panelled,
        },
      ],
    },
    {
      id: WALL.wBedroomSouth,
      a: NODE.nSplit,
      b: NODE.nSe,
      thickness: 0.3,
      role: 'facade',
      openings: [
        {
          id: OPENING.oWindowSouth,
          type: 'window',
          center: 2,
          width: 1.6,
          sill: 0.85,
          head: 2.35,
          variant: OPENING_VARIANT.window_black_slim_triple,
        },
      ],
    },
    {
      id: WALL.wEast,
      a: NODE.nSe,
      b: NODE.nNe,
      thickness: 0.3,
      role: 'facade',
      openings: [
        {
          id: OPENING.oWindowEast,
          type: 'window',
          center: 2.5,
          width: 1.5,
          sill: 0.85,
          head: 2.35,
        },
      ],
    },
    {
      id: WALL.wBedroomNorth,
      a: NODE.nNe,
      b: NODE.nNsplit,
      thickness: 0.3,
      role: 'facade',
    },
    {
      id: WALL.wLivingNorth,
      a: NODE.nNsplit,
      b: NODE.nNw,
      thickness: 0.3,
      role: 'facade',
    },
    {
      id: WALL.wWest,
      a: NODE.nNw,
      b: NODE.nSw,
      thickness: 0.3,
      role: 'facade',
    },
    {
      id: WALL.wPartition,
      a: NODE.nSplit,
      b: NODE.nNsplit,
      thickness: 0.1,
      role: 'partition',
      openings: [
        {
          id: OPENING.oDoorInner,
          type: 'door',
          center: 2.6,
          width: 0.9,
          sill: 0,
          head: 2.1,
          variant: OPENING_VARIANT.door_oak_panelled_knob,
        },
      ],
    },
  ],
  rooms: [
    {
      id: ROOM.living,
      name: 'Living room',
      anchor: {
        x: 2,
        z: 2.5,
      },
      floorMaterial: FINISH.oak,
    },
    {
      id: ROOM.bedroom,
      name: 'Bedroom',
      anchor: {
        x: 6,
        z: 2.5,
      },
      floorMaterial: FINISH.walnut,
    },
  ],
  assets: [
    {
      id: ASSET.armchair1,
      type: 'armchair',
      asset: ARCHETYPE.armchair,
      position: {
        x: 2,
        y: 0,
        z: 4.35,
      },
      variant: VARIANT.armchair_charcoal,
      room: ROOM.living,
      rotationY: 0,
    },
    {
      id: ASSET.bedDouble1,
      type: ARCHETYPE.bed_double,
      asset: ARCHETYPE.bed_double,
      position: {
        x: 6,
        y: 0,
        z: 3.73,
      },
      variant: VARIANT.bed_double_boucle,
      room: ROOM.bedroom,
      rotationY: 0,
    },
  ],
  presentationCamera: {
    position: {
      x: 4,
      y: 9,
      z: 14,
    },
    target: {
      x: 4,
      y: 1,
      z: 2.5,
    },
  },
  walkSpawn: {
    position: {
      x: 1.2,
      y: 1.6,
      z: 1.6,
    },
    target: {
      x: 2,
      y: 1.4,
      z: 4,
    },
  },
  roomCameras: {
    [ROOM.living]: {
      position: {
        x: 1.2,
        y: 1.6,
        z: 1.6,
      },
      target: {
        x: 2,
        y: 1.4,
        z: 4,
      },
    },
    [ROOM.bedroom]: {
      position: {
        x: 6,
        y: 1.6,
        z: 1.6,
      },
      target: {
        x: 6,
        y: 1.4,
        z: 4,
      },
    },
  },
  navigation: {
    points: [
      {
        x: 1.2,
        y: 0,
        z: 1.6,
      },
      {
        x: 2.5,
        y: 0,
        z: 2.5,
      },
      {
        x: 4,
        y: 0,
        z: 2.6,
      },
      {
        x: 6,
        y: 0,
        z: 2.5,
      },
    ],
  },
  autotour: {
    speed: 1.2,
    path: [
      {
        x: 1.2,
        y: 1.6,
        z: 1.6,
      },
      {
        x: 2.5,
        y: 1.6,
        z: 2.5,
      },
      {
        x: 4,
        y: 1.6,
        z: 2.6,
      },
      {
        x: 6,
        y: 1.6,
        z: 2.5,
      },
    ],
    gaze: [
      {
        at: 1,
        target: {
          x: 2,
          y: 1.5,
          z: 0,
        },
      },
    ],
    zones: [
      {
        at: 2,
        speed: 0.9,
      },
    ],
  },
  finishes: {
    rooms: {
      [ROOM.bedroom]: {
        walls: FINISH.wallpaper_cream,
        floor: FINISH.walnut,
      },
    },
  },
  tourCheckpoints: [
    {
      id: CHECKPOINT.cam1,
      position: {
        x: 6.264527282220168,
        y: 1.5221292593404376,
        z: 2.9857061358258115,
      },
      yaw: -0.2835504865804849,
      pitch: -0.36180199611396047,
    },
    {
      id: CHECKPOINT.cam3,
      position: {
        x: 1.0782299038231398,
        y: 1.1945984136516863,
        z: 0.5569286074015984,
      },
      yaw: 0.07514916076925943,
      pitch: -0.7607963267948973,
    },
    {
      id: CHECKPOINT.cam2,
      position: {
        x: 1.6161197452060234,
        y: 1.2221840405441338,
        z: 3.7587617306596943,
      },
      yaw: 0.6652205371362765,
      pitch: -0.8006646259971648,
    },
  ],
};
