/**
 * The shell meshes a light bake is made for, in one fixed order, each with
 * the contract it carries through a shell file (`shell-extras.schema.ts`).
 *
 * Both sides of the round trip read the shell through `shellEntries`: the
 * export writes what it answers for a freshly built shell, and the loader
 * asks it again for the live shell and requires the shipped file to answer
 * the same, mesh for mesh. Order is depth-first through the
 * `parametric-shell` group, exactly the build order.
 *
 * In the shell: floors, ceilings, wall faces, skirtings, junction cores, the
 * site slab and ground, and the static parts of every opening (frames,
 * sills, bars and glazing). Out of it: door leaves and everything under them
 * (they animate and count as furniture), the invisible pick proxies (a
 * raycast helper, never drawn) and shadow-only casters.
 *
 * `visible` is the mesh as the full shell state draws it (the state a walk
 * shows): a ceiling the dollhouse hides at run time is still visible here,
 * since the bake needs it as a caster.
 *
 * A shell file writes each entry as its parts (`shellParts`): the triangles
 * a walk can see, then the ones it cannot (`geometry/shell-unseen.ts`), the
 * second part marked `unseen`. The parts are read from the geometry the
 * builders recorded, so they describe the shell as built; on an adopted
 * shell `shellEntries` still lists the same meshes (the children that draw
 * unseen parts are not shell meshes), but their parts are the adopted ones.
 *
 * Invariant: an entry's extras depend on the scene and the built shell only,
 * never on a mesh name, so two exports with different id minters answer the
 * same. A mesh this module does not know refuses the whole walk (a
 * `LightBakeError` of reason `shell`).
 */

import * as THREE from 'three';
import type { BuilderContext } from '../geometry/builder-context.js';
import { openingMaterialFacts } from '../geometry/opening-kinds.js';
import { firstFrameColour } from '../materials/library-material.js';
import { DEFAULT_WALL_FINISH, faceFinishRefOf, floorFinishRefOf } from '../scene/scene-ops.js';
import { isFaceKey, type FaceKey, type FinishRef, type OpeningType, type SceneData } from '../scene/types.js';
import { FINISH } from '../materials/finish-ids.js';
import { unseenTriangles } from '../geometry/shell-unseen.js';
import { LightBakeError } from './light-bake-error.js';
import type { ShellMaterialExtras, ShellNodeExtras } from './shell-extras.schema.js';

/** The finish every ceiling wears unless its room names one (`shell-builder.ts`). */
const CEILING_FINISH = FINISH.plaster_white;

/** One shell mesh with what its file must say about it. */
export type ShellEntry = {
  readonly mesh: THREE.Mesh;
  readonly extras: ShellNodeExtras;
  readonly material: ShellMaterialExtras;
  /** Flat albedo for the bake, linear Rec.709. */
  readonly albedo: readonly [number, number, number];
};

const round = (value: number): number => Math.round(value * 1e6) / 1e6;

function isPickProxy(mesh: THREE.Mesh): boolean {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return material instanceof THREE.Material && material.transparent && material.opacity === 0;
}

/** The opening group a mesh sits in, if any. */
function openingGroupOf(mesh: THREE.Object3D, shell: THREE.Object3D): THREE.Object3D | null {
  for (let at = mesh.parent; at && at !== shell; at = at.parent) if (at.userData['surface'] === 'opening') return at;
  return null;
}

function underDoorLeaf(mesh: THREE.Object3D, shell: THREE.Object3D): boolean {
  for (let at: THREE.Object3D | null = mesh; at && at !== shell; at = at.parent) if (at.userData['isDoorLeaf'] === true) return true;
  return false;
}

function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined;
}

function faceOf(mesh: THREE.Mesh): FaceKey {
  const face: unknown = mesh.userData['face'];
  if (!isFaceKey(face)) throw new LightBakeError('shell', `shell mesh ${mesh.name} has no face key`);
  return face.room === undefined ? { wallId: face.wallId, side: face.side } : { room: face.room, wallId: face.wallId, side: face.side };
}

const flagsOf = (mesh: THREE.Mesh, isCeiling: boolean) => {
  const origin = mesh.getWorldPosition(new THREE.Vector3());
  return {
    origin: [round(origin.x), round(origin.y), round(origin.z)] as const,
    visible: isCeiling ? true : mesh.visible,
    castShadow: mesh.castShadow,
    receiveShadow: mesh.receiveShadow,
  };
};

/** The contract fields of one mesh and the finish value it wears. */
function describe(
  mesh: THREE.Mesh,
  shell: THREE.Object3D,
  scene: SceneData,
  ordinals: Map<THREE.Object3D, number>,
): { extras: ShellNodeExtras; finish: FinishRef | null } {
  const data = mesh.userData;
  const group = openingGroupOf(mesh, shell);
  if (group) {
    const ordinal = ordinals.get(group) ?? 0;
    ordinals.set(group, ordinal + 1);
    const type = group.userData['openingType'] as OpeningType;
    const material = mesh.material as THREE.Material;
    // A clone (a selection highlight) has no facts, so its shell does not match a bake's and refuses.
    const facts = openingMaterialFacts.get(material);
    const glass = facts?.glass === true;
    const part = typeof data['openingPart'] === 'string' ? data['openingPart'] : undefined;
    const opening = glass ? 'glass' : type === 'door' ? 'door' : type === 'passage' ? 'void' : undefined;
    const finish = facts?.finish ?? null;
    return {
      extras: {
        kind: 'opening',
        openingId: group.userData['openingId'] as string,
        wallId: group.userData['wallId'] as string,
        openingType: type,
        entrance: group.userData['entrance'] === true,
        exterior: group.userData['isExteriorWall'] === true,
        ordinal,
        ...(part !== undefined && { part }),
        ...(data['isParametricWall'] === true && {
          band: { bottom: round(data['wallBottom'] as number), height: round(data['wallHeight'] as number) },
        }),
        ...(data['originShifted'] === true && { shifted: true as const }),
        ...(opening !== undefined && { opening }),
        ...flagsOf(mesh, false),
      },
      finish,
    };
  }
  if (mesh.name === 'site-slab' || mesh.name === 'site-ground')
    return { extras: { kind: 'site', part: mesh.name === 'site-slab' ? 'slab' : 'ground', ...flagsOf(mesh, false) }, finish: null };
  if (data['surface'] === 'floor') {
    const roomId = data['roomId'] as string;
    return { extras: { kind: 'floor', roomId, ...flagsOf(mesh, false) }, finish: floorFinishRefOf(scene, roomId) };
  }
  if (data['isCeiling'] === true) {
    const roomId = data['roomId'] as string;
    const ceiling = own(scene.finishes?.rooms, roomId)?.ceiling ?? CEILING_FINISH;
    return { extras: { kind: 'ceiling', roomId, ...flagsOf(mesh, true) }, finish: ceiling };
  }
  if (data['surface'] === 'wall') {
    const face = faceOf(mesh);
    const outward = data['outwardNormal'] as { x: number; z: number };
    return {
      extras: {
        kind: 'wall',
        face,
        exterior: data['isExteriorWall'] === true,
        outward: [round(outward.x), round(outward.z)],
        ...flagsOf(mesh, false),
      },
      finish: faceFinishRefOf(scene, face),
    };
  }
  if (mesh.name === 'wall-face-skirting') {
    const face = faceOf(mesh);
    const trim = face.room === undefined ? undefined : own(scene.finishes?.rooms, face.room)?.trim;
    return { extras: { kind: 'skirting', face, ...flagsOf(mesh, false) }, finish: trim ?? null };
  }
  if (data['wallJoint'] === true) {
    return {
      extras: { kind: 'joint', nodeId: data['nodeId'] as string, wallIds: [...(data['wallIds'] as string[])], ...flagsOf(mesh, false) },
      finish: DEFAULT_WALL_FINISH,
    };
  }
  throw new LightBakeError('shell', `shell mesh ${mesh.name || '(unnamed)'} has no contract kind`);
}

/** Flat albedo of a surface: the finish value's first-frame colour, else the material's own. */
function albedoOf(finish: FinishRef | null, material: THREE.Material, ctx: Pick<BuilderContext, 'resolve'>): [number, number, number] {
  const draw = finish === null ? null : ctx.resolve(finish);
  const colour =
    draw?.kind === 'library'
      ? firstFrameColour(draw.draw)
      : draw?.kind === 'legacy'
        ? new THREE.Color(draw.finish.base)
        : ((material as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color(1, 1, 1));
  return [round(colour.r), round(colour.g), round(colour.b)];
}

/** Every shell mesh under `shell`, in build order, with its contract. */
export function shellEntries(shell: THREE.Object3D, scene: SceneData, ctx: Pick<BuilderContext, 'resolve'>): ShellEntry[] {
  shell.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  shell.traverse((object) => {
    // A mesh under a shell mesh is the unseen part an adopted bake draws live (`shell-adopt.ts`), not a surface of its own.
    if (!(object instanceof THREE.Mesh) || object.parent instanceof THREE.Mesh) return;
    if (object.userData['shadowOnly'] === true || isPickProxy(object) || underDoorLeaf(object, shell)) return;
    meshes.push(object);
  });
  const ordinals = new Map<THREE.Object3D, number>();
  return meshes.map((mesh) => {
    if (Array.isArray(mesh.material)) throw new LightBakeError('shell', `shell mesh ${mesh.name} has more than one material`);
    const { extras, finish } = describe(mesh, shell, scene, ordinals);
    return { mesh, extras, material: { finish }, albedo: albedoOf(finish, mesh.material, ctx) };
  });
}

/** One node of a shell file: the seen or the unseen triangles of one shell entry. */
export type ShellPart = {
  readonly entry: ShellEntry;
  /** The entry's extras, plus `unseen: true` on its unseen part. */
  readonly extras: ShellNodeExtras;
  readonly unseen: boolean;
  /** The part's triangles: indices into the entry geometry's triangle order. */
  readonly triangles: readonly number[];
};

/**
 * The nodes a shell file writes for `entries`, in order: per entry its seen
 * part, then its unseen part, each only when it has triangles.
 */
export function shellParts(entries: readonly ShellEntry[]): ShellPart[] {
  return entries.flatMap((entry) => {
    const geometry = entry.mesh.geometry;
    const count = (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
    const flags = unseenTriangles(geometry);
    const seen: number[] = [];
    const unseen: number[] = [];
    for (let t = 0; t < count; t++) (flags?.[t] === 1 ? unseen : seen).push(t);
    const parts: ShellPart[] = [];
    if (seen.length > 0) parts.push({ entry, extras: entry.extras, unseen: false, triangles: seen });
    if (unseen.length > 0)
      parts.push({ entry, extras: { ...entry.extras, unseen: true } as ShellNodeExtras, unseen: true, triangles: unseen });
    return parts;
  });
}
