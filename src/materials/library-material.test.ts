import { afterEach, describe, expect, test } from 'bun:test';
import * as THREE from 'three';
import { attachLibraryMaps, createLibraryMaterial, libraryMapFormat } from './library-material.js';
import type { LibraryDraw } from './room-finish.js';
import type { LibraryMaterial, LibraryPbr, ProjectMaterial } from './finish-types.js';
import { NATURAL_SCAN, PAINT, TINTABLE_SCAN } from '../fixtures/library-materials.js';
import { BUILTIN_FINISHES } from './builtin-library.js';
import { FINISH } from './finish-ids.js';

/** The library member of a fixture material. */
const libraryOf = (material: ProjectMaterial): LibraryMaterial => (material as Extract<ProjectMaterial, { library: unknown }>).library;

/** A draw of `material` with an optional tint. */
function draw(material: ProjectMaterial, colour?: string): LibraryDraw {
  return { id: material.id, material: libraryOf(material), ...(colour !== undefined && { colour }), rotation: 0 };
}

/** `material` with its PBR facts replaced. */
function withPbr(material: ProjectMaterial, pbr: LibraryPbr): LibraryDraw {
  const library = libraryOf(material);
  return { id: material.id, material: { ...library, facts: { ...library.facts, pbr } }, rotation: 0 };
}

/** `drawn` with every file of its material shipped as KTX2. */
function asKtx2(drawn: LibraryDraw): LibraryDraw {
  const maps = Object.fromEntries(
    Object.entries(drawn.material.maps).map(([role, map]) => [
      role,
      { ...map, files: Object.fromEntries(Object.entries(map.files).map(([size, path]) => [size, path.replace(/\.webp$/, '.ktx2')])) },
    ]),
  );
  return { ...drawn, material: { ...drawn.material, maps } };
}

describe('libraryMapFormat', () => {
  test('the extension every file of the material shares; WebP for a material with no maps', () => {
    expect(libraryMapFormat(libraryOf(NATURAL_SCAN))).toBe('webp');
    expect(libraryMapFormat(asKtx2(draw(NATURAL_SCAN)).material)).toBe('ktx2');
    expect(libraryMapFormat(libraryOf(PAINT))).toBe('webp');
  });
});

/** The linear mean a `luma-mid@1` tint map is normalised to: sRGB 0.5, as the catalogue writes it. */
const MID_GREY_LINEAR = new THREE.Color().setRGB(0.5, 0.5, 0.5, THREE.SRGBColorSpace).r;

/** True when two linear colours agree within `steps` 8-bit sRGB steps of each other. */
function closeTo(actual: THREE.Color, expected: THREE.Color, steps = 0.5): boolean {
  const a = actual.clone().convertLinearToSRGB();
  const b = expected.clone().convertLinearToSRGB();
  const within = (x: number, y: number) => Math.abs(x - y) < steps / 255 + 1e-9;
  return within(a.r, b.r) && within(a.g, b.g) && within(a.b, b.b);
}

/** The material's colour as `#rrggbb` (sRGB). */
const hexOf = (material: THREE.MeshStandardMaterial): string => `#${material.color.getHexString()}`;

describe('createLibraryMaterial: the first frame', () => {
  test('a natural material draws its averageColour, and ignores a colour', () => {
    expect(hexOf(createLibraryMaterial(draw(NATURAL_SCAN)))).toBe('#9a7b56');
    expect(hexOf(createLibraryMaterial(draw(NATURAL_SCAN, '#ff0000')))).toBe('#9a7b56');
  });

  test('a tintable scan draws averageColour times the tint times its recipe gain, in linear light', () => {
    const gain = 1 / MID_GREY_LINEAR;
    const expected = new THREE.Color('#808080').multiply(new THREE.Color('#ff0000')).multiplyScalar(gain);
    expect(closeTo(createLibraryMaterial(draw(TINTABLE_SCAN, '#ff0000')).color, expected)).toBe(true);
    const suggested = new THREE.Color('#808080').multiply(new THREE.Color('#c9d6df')).multiplyScalar(gain);
    expect(closeTo(createLibraryMaterial(draw(TINTABLE_SCAN)).color, suggested)).toBe(true);
  });

  test('a tint in the scan’s own colour reproduces the scan’s mean on the first frame', () => {
    // `luma-mid@1` normalises the tint map to a mid-grey mean, which is the
    // averageColour of a tintable scan; the natural tint must give the scan back.
    // `#808080` is 128/255, a hair above the map's exact mean, so the flat
    // placeholder may be one 8-bit step bright; the map path below is exact.
    expect(closeTo(createLibraryMaterial(draw(TINTABLE_SCAN, '#9a8d7a')).color, new THREE.Color('#9a8d7a'), 1)).toBe(true);
  });

  test('a tintable paint draws exactly its tint, never its base colour or a product of the two', () => {
    expect(hexOf(createLibraryMaterial(draw(PAINT, '#2050a0')))).toBe('#2050a0');
    expect(hexOf(createLibraryMaterial(draw(PAINT)))).toBe('#f1eee8');
  });

  test('defaults are applied when drawing: metalness 0, roughness 1, opaque', () => {
    const material = createLibraryMaterial(withPbr(NATURAL_SCAN, {}));
    expect({
      metalness: material.metalness,
      roughness: material.roughness,
      transparent: material.transparent,
      alphaTest: material.alphaTest,
    }).toEqual({
      metalness: 0,
      roughness: 1,
      transparent: false,
      alphaTest: 0,
    });
  });

  test('the scalar facts are applied: roughness, metalness, emissive, blend and mask', () => {
    const material = createLibraryMaterial(
      withPbr(NATURAL_SCAN, { roughness: 0.3, metalness: 1, emissive: '#102030', emissiveIntensity: 2, alphaMode: 'blend', opacity: 0.5 }),
    );
    expect({
      roughness: material.roughness,
      metalness: material.metalness,
      emissive: `#${material.emissive.getHexString()}`,
      emissiveIntensity: material.emissiveIntensity,
      transparent: material.transparent,
      opacity: material.opacity,
    }).toEqual({ roughness: 0.3, metalness: 1, emissive: '#102030', emissiveIntensity: 2, transparent: true, opacity: 0.5 });
    expect(createLibraryMaterial(withPbr(NATURAL_SCAN, { alphaMode: 'mask' })).alphaTest).toBe(0.5);
  });

  test('each physical field, and only a physical field, promotes the material to the physical model', () => {
    const fields: LibraryPbr[] = [
      { sheen: 0.5 },
      { sheenColour: '#ffffff' },
      { sheenRoughness: 0.6 },
      { clearcoat: 0.5 },
      { clearcoatRoughness: 0.5 },
      { transmission: 0.5 },
      { ior: 1.5 },
      { thicknessM: 0.01 },
      { attenuationDistanceM: 1 },
      { attenuationColour: '#ffffff' },
    ];
    for (const pbr of fields) {
      expect({ pbr, physical: createLibraryMaterial(withPbr(NATURAL_SCAN, pbr)) instanceof THREE.MeshPhysicalMaterial }).toEqual({
        pbr,
        physical: true,
      });
    }
    expect(createLibraryMaterial(withPbr(NATURAL_SCAN, { roughness: 0.5, metalness: 0.5 })) instanceof THREE.MeshPhysicalMaterial).toBe(
      false,
    );
  });

  test('ior alone gives a physical material whose index of refraction is that ior', () => {
    const material = createLibraryMaterial(withPbr(NATURAL_SCAN, { ior: 1.5 }));
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect((material as THREE.MeshPhysicalMaterial).ior).toBe(1.5);
  });

  test('the physical fields reach their three.js names', () => {
    const material = createLibraryMaterial(
      withPbr(NATURAL_SCAN, {
        sheen: 0.4,
        sheenColour: '#ff0000',
        clearcoat: 0.6,
        clearcoatRoughness: 0.2,
        transmission: 0.7,
        thicknessM: 0.02,
        attenuationDistanceM: 3,
        attenuationColour: '#00ff00',
      }),
    ) as THREE.MeshPhysicalMaterial;
    expect({
      sheen: material.sheen,
      sheenColor: `#${material.sheenColor.getHexString()}`,
      clearcoat: material.clearcoat,
      clearcoatRoughness: material.clearcoatRoughness,
      transmission: material.transmission,
      thickness: material.thickness,
      attenuationDistance: material.attenuationDistance,
      attenuationColor: `#${material.attenuationColor.getHexString()}`,
    }).toEqual({
      sheen: 0.4,
      sheenColor: '#ff0000',
      clearcoat: 0.6,
      clearcoatRoughness: 0.2,
      transmission: 0.7,
      thickness: 0.02,
      attenuationDistance: 3,
      attenuationColor: '#00ff00',
    });
  });
});

describe('createLibraryMaterial: the sheen lobe of a cloth', () => {
  /** A cotton cloth: a tintable `luma-mid@1` scan with the sheen facts of its fabric. */
  const CLOTH: LibraryPbr = { roughness: 0.85, sheen: 0.3, sheenRoughness: 0.6 };

  /** The cloth drawn with `pbr`, in `colour` when given. */
  function cloth(pbr: LibraryPbr, colour?: string): THREE.MeshPhysicalMaterial {
    const drawn = withPbr(TINTABLE_SCAN, pbr);
    const material = createLibraryMaterial({ ...drawn, ...(colour !== undefined && { colour }) });
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    return material as THREE.MeshPhysicalMaterial;
  }

  test('stated sheen, sheen roughness and sheen colour reach the physical material, the colour in linear light', () => {
    const material = cloth({ ...CLOTH, sheenColour: '#d0c8b8' }, '#5a6b8c');
    expect({ sheen: material.sheen, sheenRoughness: material.sheenRoughness }).toEqual({ sheen: 0.3, sheenRoughness: 0.6 });
    expect(closeTo(material.sheenColor, new THREE.Color('#d0c8b8'))).toBe(true);
  });

  test('sheen roughness alone gives a physical material with that sheen roughness', () => {
    expect(cloth({ sheenRoughness: 0.6 }).sheenRoughness).toBe(0.6);
  });

  /** `hex` lifted toward white by the stated sheen lift of 0.2, in linear light. */
  const lifted = (hex: string): THREE.Color => new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), 0.2);

  test('a sheen without a colour takes the plain tint lifted toward white, never the tint times the recipe gain', () => {
    expect(closeTo(cloth(CLOTH, '#5a6b8c').sheenColor, lifted('#5a6b8c'))).toBe(true);
  });

  test('a stated sheen lift replaces the default of 0.2 for a sheen without a colour', () => {
    const lift = (hex: string, by: number): THREE.Color => new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), by);
    expect(closeTo(cloth({ ...CLOTH, sheenLift: 0.5 }, '#5a6b8c').sheenColor, lift('#5a6b8c', 0.5))).toBe(true);
    expect(closeTo(cloth({ ...CLOTH, sheenLift: 0 }, '#5a6b8c').sheenColor, lift('#5a6b8c', 0))).toBe(true);
  });

  test('a sheen lift beside a stated sheen colour leaves the colour as stated', () => {
    expect(closeTo(cloth({ ...CLOTH, sheenColour: '#d0c8b8', sheenLift: 0.5 }).sheenColor, new THREE.Color('#d0c8b8'))).toBe(true);
  });

  test('a sheen lift alone keeps the standard material model', () => {
    expect(createLibraryMaterial(withPbr(NATURAL_SCAN, { sheenLift: 0.5 }))).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
  });

  test('a sheen without a colour or a finish colour takes the first suggested colour lifted toward white', () => {
    expect(closeTo(cloth(CLOTH).sheenColor, lifted('#c9d6df'))).toBe(true);
  });

  test('a sheen without a colour on an untinted material is white', () => {
    const material = createLibraryMaterial(withPbr(NATURAL_SCAN, CLOTH)) as THREE.MeshPhysicalMaterial;
    expect(`#${material.sheenColor.getHexString()}`).toBe('#ffffff');
  });

  test('an absent sheen roughness keeps three’s default of 1', () => {
    expect(cloth({ sheen: 0.3, sheenColour: '#ffffff' }).sheenRoughness).toBe(1);
  });
});

describe('attachLibraryMaps', () => {
  const view = (): THREE.Texture => new THREE.Texture();

  test('a natural colour map turns the colour white, so the map is drawn as is, and marks the material for recompilation', () => {
    const material = createLibraryMaterial(draw(NATURAL_SCAN));
    const version = material.version;
    const albedo = view();
    attachLibraryMaps(material, draw(NATURAL_SCAN), { albedo });
    expect(material.map).toBe(albedo);
    expect(hexOf(material)).toBe('#ffffff');
    expect(material.version).toBeGreaterThan(version);
  });

  test('a tintable scan’s tint map is drawn times the tint and its recipe gain', () => {
    const material = createLibraryMaterial(draw(TINTABLE_SCAN, '#ff0000'));
    attachLibraryMaps(material, draw(TINTABLE_SCAN, '#ff0000'), { albedoTint: view() });
    expect(closeTo(material.color, new THREE.Color('#ff0000').multiplyScalar(1 / MID_GREY_LINEAR))).toBe(true);
  });

  test('a tint map of mid-grey mean drawn in the scan’s own colour reproduces the scan’s mean', () => {
    const natural = draw(TINTABLE_SCAN, '#9a8d7a');
    const material = createLibraryMaterial(natural);
    attachLibraryMaps(material, natural, { albedoTint: view() });
    // The drawn mean is the map's linear mean (mid grey) times the colour factor.
    const drawn = material.color.clone().multiplyScalar(MID_GREY_LINEAR);
    expect(closeTo(drawn, new THREE.Color('#9a8d7a'))).toBe(true);
  });

  test('a scan’s baseColour multiplies its colour map by glTF rules', () => {
    const tinted = withPbr(NATURAL_SCAN, { baseColour: '#808080' });
    const material = createLibraryMaterial(tinted);
    attachLibraryMaps(material, tinted, { albedo: view() });
    expect(hexOf(material)).toBe('#808080');
  });

  test('one ARM view feeds ambient occlusion, roughness and metalness, AO on the primary UV set', () => {
    const material = createLibraryMaterial(draw(NATURAL_SCAN));
    const arm = view();
    attachLibraryMaps(material, draw(NATURAL_SCAN), { arm });
    expect([material.aoMap, material.roughnessMap, material.metalnessMap]).toEqual([arm, arm, arm]);
    expect(arm.channel).toBe(0);
    // Absent metalness stays 0, so the ARM blue channel cannot make it metallic.
    expect([material.metalness, material.roughness]).toEqual([0, 1]);
  });

  test('metalness 1 lets the ARM blue channel decide', () => {
    const metal = withPbr(NATURAL_SCAN, { metalness: 1 });
    const material = createLibraryMaterial(metal);
    attachLibraryMaps(material, metal, { arm: view() });
    expect(material.metalness).toBe(1);
  });

  test('separate roughness and AO maps take their own slots', () => {
    const material = createLibraryMaterial(draw(TINTABLE_SCAN));
    const roughness = view();
    const ao = view();
    attachLibraryMaps(material, draw(TINTABLE_SCAN), { roughness, ao });
    expect([material.roughnessMap, material.aoMap, material.metalnessMap]).toEqual([roughness, ao, null]);
    expect(ao.channel).toBe(0);
    expect(material.roughness).toBe(0.9);
  });

  test('the normal map is read with a scale of normalStrength, 1 when absent', () => {
    const scan = createLibraryMaterial(draw(NATURAL_SCAN));
    attachLibraryMaps(scan, draw(NATURAL_SCAN), { normal: view() });
    expect([scan.normalScale.x, scan.normalScale.y]).toEqual([1, 1]);
    const weave = createLibraryMaterial(draw(TINTABLE_SCAN));
    attachLibraryMaps(weave, draw(TINTABLE_SCAN), { normal: view() });
    expect([weave.normalScale.x, weave.normalScale.y]).toEqual([0.8, 0.8]);
  });

  test('a KTX2 normal map has its vertical scale negated after the strength, because its texture axis is reversed', () => {
    const ktx2 = asKtx2(draw(TINTABLE_SCAN));
    const weave = createLibraryMaterial(ktx2);
    attachLibraryMaps(weave, ktx2, { normal: view() });
    expect([weave.normalScale.x, weave.normalScale.y]).toEqual([0.8, -0.8]);
  });

  test('a KTX2 albedoTint gets exactly the colour factor and first-frame colour of a WebP one', () => {
    const webp = draw(TINTABLE_SCAN, '#ff0000');
    const ktx2 = asKtx2(webp);
    const [first, firstKtx2] = [createLibraryMaterial(webp), createLibraryMaterial(ktx2)];
    expect(hexOf(firstKtx2)).toBe(hexOf(first));
    attachLibraryMaps(first, webp, { albedoTint: view() });
    attachLibraryMaps(firstKtx2, ktx2, { albedoTint: view() });
    expect(firstKtx2.color.equals(first.color)).toBe(true);
  });

  test('attaching nothing new changes nothing', () => {
    const material = createLibraryMaterial(draw(PAINT));
    const version = material.version;
    attachLibraryMaps(material, draw(PAINT), {});
    expect(material.version).toBe(version);
    expect(hexOf(material)).toBe('#f1eee8');
  });
});

describe('the diagnostic switches', () => {
  const page = globalThis as { __JEEX_DEBUG_FLAGS__?: unknown };
  afterEach(() => {
    delete page.__JEEX_DEBUG_FLAGS__;
  });

  test('`noTransmission` keeps a library material’s transmission at 0', () => {
    page.__JEEX_DEBUG_FLAGS__ = { noTransmission: true };
    const material = createLibraryMaterial(withPbr(NATURAL_SCAN, { transmission: 0.7 })) as THREE.MeshPhysicalMaterial;
    expect(material.transmission).toBe(0);
  });

  test('`noArm` attaches no ARM view and keeps the roughness and occlusion scalars', () => {
    page.__JEEX_DEBUG_FLAGS__ = { noArm: true };
    const material = createLibraryMaterial(draw(NATURAL_SCAN));
    const scalars = [material.roughness, material.aoMapIntensity, material.metalness];
    attachLibraryMaps(material, draw(NATURAL_SCAN), { arm: new THREE.Texture() });
    expect([material.aoMap, material.roughnessMap, material.metalnessMap]).toEqual([null, null, null]);
    expect([material.roughness, material.aoMapIntensity, material.metalness]).toEqual(scalars);
  });
});

describe('a glazed bundled tile', () => {
  test('the zellige draws on the physical model with its clear coat', () => {
    const binding = BUILTIN_FINISHES.get(FINISH.zellige)!;
    const material = createLibraryMaterial({ id: FINISH.zellige, material: binding.material, rotation: binding.rotation, builtin: true });
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    const physical = material as THREE.MeshPhysicalMaterial;
    expect({ clearcoat: physical.clearcoat, clearcoatRoughness: physical.clearcoatRoughness }).toEqual({
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    });
  });
});
