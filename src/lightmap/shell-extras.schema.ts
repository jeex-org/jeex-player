/**
 * The shell GLB contract (format 1) as a `zod/mini` schema: what a shipped
 * apartment shell carries in glTF `extras` so that the player can give every
 * mesh back its run-time behaviour, which `userData` callbacks cannot carry
 * through a file.
 *
 * The file is written in two steps. The player's `exportShellForBake` writes
 * the shell as built from the scene; the bake tool then adds `TEXCOORD_1` (it
 * may split vertices at chart seams, so vertex and index counts change) and
 * writes the final file. Every rule below holds for both files; the bake tool
 * keeps node and mesh names, node order, materials and every `extras` object
 * exactly as exported.
 *
 * - `asset.extras.jeex`: `{ format: 1, sceneId, shellInputsHash }`. The hash
 *   is `shell-inputs.ts`'s digest of the scene inputs the shell depends on.
 * - Every node is a root node with a mesh and an identity transform: no
 *   `matrix`, `translation`, `rotation` or `scale` (the bake needs world-space
 *   vertices). Node name and mesh name are the same UUID v7, unique in the
 *   file. The ids are minted by the exporter's caller, the owner of the shell
 *   file; the scene does not have one id per surface, and the player never
 *   reads a mesh's identity from its name, only from `extras.jeex`.
 * - Each mesh has exactly one primitive with `POSITION`, `NORMAL`,
 *   `TEXCOORD_0` and optionally `TEXCOORD_1`, and one material.
 * - `node.extras.jeex` (`ShellNodeExtras`): the mesh's structured identity
 *   (`kind` and the scene ids it belongs to), its run-time origin (`origin`,
 *   world metres; the player moves the node there and the vertices by the
 *   opposite, so the world result is unchanged) and its render flags.
 *   `opening` is present only on meshes of a window, door or passage:
 *   `'glass'` for glazing, which transmits sky and sun; `'door'` for a door's
 *   frame, whose leaf animates and is not in the shell; `'void'` for an open
 *   passage's frame. Window frames and sills carry no `opening`.
 * - `material.extras.jeex`: `{ finish }`, the scene finish value the surface
 *   wears (`FinishRef`), or `null` for a surface with a fixed colour. The
 *   material itself holds the flat linear albedo as `baseColorFactor` and no
 *   texture.
 *
 * Invariant: the schema JUDGES and never repairs. Pure module: no `three`,
 * no DOM.
 */

import { z } from 'zod/mini';
import { UUID_V7_PATTERN } from '../scene/types.js';
import { faceKeySchema, finishRefSchema } from '../scene/types.schema.js';

const uuid = z.string().check(z.regex(UUID_V7_PATTERN, { error: 'not a UUID v7' }));
const finite = z.number().check(z.refine(Number.isFinite, { error: 'must be finite' }));
const nonNegative = finite.check(z.gte(0, { error: 'must not be negative' }));
const hash = z.string().check(z.regex(/^sha256:[0-9a-f]{64}$/, { error: 'not a sha256 digest' }));
const vec3 = z.readonly(z.tuple([finite, finite, finite]));
const index = z.int({ error: 'must be an integer' }).check(z.gte(0, { error: 'must not be negative' }));

/** Render flags every shell mesh carries. */
const flags = {
  origin: vec3,
  visible: z.boolean(),
  castShadow: z.boolean(),
  receiveShadow: z.boolean(),
};

/** A part of a wall that the dollhouse cuts away by height: the band it spans, metres. */
const band = z.strictObject({ bottom: finite, height: nonNegative });

/** The structured identity and run-time contract of one shell mesh, by kind. */
export const shellNodeExtrasSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('floor'), roomId: uuid, ...flags }),
  z.strictObject({ kind: z.literal('ceiling'), roomId: uuid, ...flags }),
  z.strictObject({
    kind: z.literal('wall'),
    face: faceKeySchema,
    exterior: z.boolean(),
    /** Plan direction out of the wall body on the room's side (out of the building on the facade). */
    outward: z.readonly(z.tuple([finite, finite])),
    ...flags,
  }),
  z.strictObject({ kind: z.literal('skirting'), face: faceKeySchema, ...flags }),
  z.strictObject({ kind: z.literal('joint'), nodeId: uuid, wallIds: z.readonly(z.array(uuid)), ...flags }),
  z.strictObject({ kind: z.literal('site'), part: z.enum(['slab', 'ground']), ...flags }),
  z.strictObject({
    kind: z.literal('opening'),
    openingId: uuid,
    wallId: uuid,
    openingType: z.enum(['door', 'window', 'passage']),
    entrance: z.boolean(),
    exterior: z.boolean(),
    /** Position of the mesh among the shell meshes of its opening, in build order. */
    ordinal: index,
    /** The builder's own name for the part (`pane`, `post`, …), when it gives one. */
    part: z.optional(z.string().check(z.minLength(1))),
    /** Present on a frame part the dollhouse lowers with its wall. */
    band: z.optional(band),
    /** A door frame part moved off the wall centreline towards the leaf's side. */
    shifted: z.optional(z.literal(true)),
    opening: z.optional(z.enum(['glass', 'door', 'void'])),
    ...flags,
  }),
]);

export type ShellNodeExtras = z.infer<typeof shellNodeExtrasSchema>;

export const shellMaterialExtrasSchema = z.strictObject({ finish: z.nullable(finishRefSchema) });
export type ShellMaterialExtras = z.infer<typeof shellMaterialExtrasSchema>;

export const shellAssetExtrasSchema = z.strictObject({ format: z.literal(1), sceneId: uuid, shellInputsHash: hash });

const jeex = <T extends z.ZodMiniType>(schema: T) => z.looseObject({ jeex: schema });

const node = z.looseObject({
  name: uuid,
  mesh: index,
  extras: jeex(shellNodeExtrasSchema),
  matrix: z.optional(z.never({ error: 'a shell node has an identity transform' })),
  translation: z.optional(z.never({ error: 'a shell node has an identity transform' })),
  rotation: z.optional(z.never({ error: 'a shell node has an identity transform' })),
  scale: z.optional(z.never({ error: 'a shell node has an identity transform' })),
  children: z.optional(z.never({ error: 'a shell node has no children' })),
});

const attributes = z.looseObject({ POSITION: index, NORMAL: index, TEXCOORD_0: index, TEXCOORD_1: z.optional(index) });

const mesh = z.looseObject({
  name: uuid,
  primitives: z.tuple([z.looseObject({ attributes, material: index })], { error: 'a shell mesh has exactly one primitive' }),
});

const material = z.looseObject({ extras: jeex(shellMaterialExtrasSchema) });

/** The glTF JSON chunk of a shell file, as far as the contract reaches. */
export const shellGltfSchema = z
  .looseObject({
    asset: z.looseObject({ version: z.literal('2.0'), extras: jeex(shellAssetExtrasSchema) }),
    scene: z.optional(z.literal(0)),
    scenes: z.tuple([z.looseObject({ nodes: z.array(index) })], { error: 'a shell file has exactly one scene' }),
    nodes: z.array(node).check(z.minLength(1, { error: 'a shell file has at least one node' })),
    meshes: z.array(mesh),
    materials: z.array(material),
  })
  .check(
    z.superRefine((gltf, ctx) => {
      const names = new Set<string>();
      for (const [i, entry] of gltf.nodes.entries()) {
        if (names.has(entry.name))
          ctx.addIssue({ code: 'custom', path: ['nodes', i, 'name'], message: `name ${entry.name} is used twice` });
        names.add(entry.name);
        const target = gltf.meshes[entry.mesh];
        if (!target) {
          ctx.addIssue({ code: 'custom', path: ['nodes', i, 'mesh'], message: `mesh ${String(entry.mesh)} does not exist` });
          continue;
        }
        if (target.name !== entry.name)
          ctx.addIssue({ code: 'custom', path: ['meshes', entry.mesh, 'name'], message: 'the mesh name differs from its node name' });
        const materialIndex = target.primitives[0].material;
        if (!gltf.materials[materialIndex])
          ctx.addIssue({
            code: 'custom',
            path: ['meshes', entry.mesh, 'primitives', 0, 'material'],
            message: `material ${String(materialIndex)} does not exist`,
          });
      }
      const roots = gltf.scenes[0].nodes;
      if (roots.length !== gltf.nodes.length || roots.some((root, i) => root !== i))
        ctx.addIssue({ code: 'custom', path: ['scenes', 0, 'nodes'], message: 'the scene lists every node once, in node order' });
    }),
  );

/** The judged glTF document, or the sentence that names what was refused. */
export type ShellGltfVerdict = { readonly ok: true; readonly value: ShellGltf } | { readonly ok: false; readonly message: string };
export type ShellGltf = z.infer<typeof shellGltfSchema>;

/** Judges the parsed JSON chunk of a shell file. */
export function judgeShellGltf(input: unknown): ShellGltfVerdict {
  const result = z.safeParse(shellGltfSchema, input);
  if (result.success) return { ok: true, value: input as ShellGltf };
  const issues = result.error.issues.slice(0, 8).map((issue) => {
    const keys = issue.code === 'unrecognized_keys' ? issue.keys : [];
    const where = [...issue.path.map(String), ...keys].join('.') || 'shell';
    return `${where}: ${issue.message}`;
  });
  return { ok: false, message: `shell refused: ${issues.join('; ')}` };
}
