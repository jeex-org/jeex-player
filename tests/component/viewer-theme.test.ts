/**
 * The host-settable theme, against a real style engine and a real 2D canvas.
 *
 * Three things a host page reaches from CSS alone: the 3D backdrop (a custom
 * property resolved to an opaque colour and handed to the runtime's own sky),
 * the accent with every companion shade derived from it, and the surface the
 * loading and error cards paint. The package defaults are neutral graphite:
 * nothing of the former beige and gold survives an embed that sets nothing.
 */

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { InlineSceneRepository, mountViewer } from '../../src/app/viewer-api.js';
import { createRenderRuntime, type RenderRuntime } from '../../src/render/render-runtime.js';
import { GridBake } from '../../src/render/walk-lighting/grid-bake.js';
import { findSiteGround } from '../../src/geometry/site-ground.js';
import { resolveBackdrop, resolveThemeColour } from '../../src/ui/theme-colour.js';
import { createViewerShell, THEME_PROPERTIES } from '../../src/ui/viewer-shell.js';
import { createMessages } from '../../src/ui/messages.js';
import { lShapePlan } from '../../src/fixtures/plan-l-shape.js';
import { L_SHAPE } from '../../src/fixtures/plan-l-shape-ids.js';
import { closeContainers, demoScene, nextFrame, openContainer, until } from './support.js';

/** The former warm palette: none of it may survive the neutral defaults. */
const FORMER_GOLD = [
  'rgb(168, 129, 58)',
  'rgb(223, 189, 125)',
  'rgb(176, 141, 71)',
  'rgb(213, 178, 116)',
  'rgb(141, 107, 44)',
  'rgb(233, 205, 143)',
];
const FORMER_BEIGE = 'rgb(198, 184, 163)';

let container: HTMLElement;
const runtimes: RenderRuntime[] = [];
/** The daylight sky's horizon, which walk and tour keep whatever the theme (`render-runtime.ts`). */
const DAYLIGHT_HORIZON = '#b9b9b9';
const DARK = '#101418';

beforeEach(() => {
  document.body.replaceChildren();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  closeContainers();
});

/** A runtime on a real canvas whose frames never run on their own. */
function runtimeIn(host: HTMLElement): RenderRuntime {
  const canvas = document.createElement('canvas');
  host.appendChild(canvas);
  const runtime = createRenderRuntime({
    canvas,
    viewport: { clientWidth: 64, clientHeight: 64, element: host },
    scheduleFrame: () => 0,
    cancelFrame: () => undefined,
  });
  runtimes.push(runtime);
  return runtime;
}

/** The rgb of one pixel of a canvas texture's own canvas, row `y` of its height. */
function skyPixel(texture: THREE.Texture, at: 'top' | 'bottom'): [number, number, number] {
  const canvas = texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const y = at === 'top' ? 0 : Math.floor(canvas.height * 0.62);
  const [r, g, b] = ctx.getImageData(Math.floor(canvas.width / 2), y, 1, 1).data;
  return [r!, g!, b!];
}

/** True when every channel of `pixel` is within `tolerance` of `hex` (the sky carries a faint noise veil). */
function near(pixel: [number, number, number], hex: string, tolerance = 10): boolean {
  // Canvas pixels and CSS hex are both sRGB bytes: compared as they are.
  const want = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return pixel.every((channel, index) => Math.abs(channel - want[index]!) <= tolerance);
}

describe('resolveThemeColour', () => {
  test('hex, rgb(), light-dark() in both schemes and color-mix() resolve to opaque hex; alpha is dropped', () => {
    const roots = createViewerShell(container, createMessages('en'));
    const root = roots.root;
    const cases: [string, string][] = [
      ['#20242a', '#20242a'],
      ['rgb(10 20 30)', '#0a141e'],
      ['rgb(10 20 30 / 40%)', '#0a141e'],
      // 40% of 255 is 102 exactly: a 50% mix lands on 127.5, which a GPU and SwiftShader round apart.
      ['color-mix(in srgb, #000000, #ffffff 40%)', '#666666'],
    ];
    for (const [value, expected] of cases) {
      root.style.setProperty('--jeex-test-colour', value);
      expect(resolveThemeColour(root, '--jeex-test-colour', '#123456'), value).toBe(expected);
    }
    root.style.setProperty('--jeex-test-colour', 'light-dark(#ffffff, #000000)');
    root.style.setProperty('--jeex-color-scheme', 'light');
    expect(resolveThemeColour(root, '--jeex-test-colour', '#123456')).toBe('#ffffff');
    root.style.setProperty('--jeex-color-scheme', 'dark');
    expect(resolveThemeColour(root, '--jeex-test-colour', '#123456')).toBe('#000000');
  });

  test('a value that is not a colour, or no value, falls back', () => {
    const roots = createViewerShell(container, createMessages('en'));
    roots.root.style.setProperty('--jeex-test-colour', '12px');
    expect(resolveThemeColour(roots.root, '--jeex-test-colour', '#123456')).toBe('#123456');
    expect(resolveThemeColour(roots.root, '--jeex-not-set', '#123456')).toBe('#123456');
  });

  test('an invalid backdrop falls back to the NEUTRAL default, never to beige', () => {
    const roots = createViewerShell(container, createMessages('en'));
    roots.root.style.setProperty('--jeex-backdrop', 'not-a-colour');
    const backdrop = resolveBackdrop(roots.root);
    expect(backdrop.horizon).toBe('#303640');
    expect(backdrop.top).not.toBe('#dcd3c2');
  });

  test('the backdrop pair: the host horizon, and a top a little lighter unless the host names one', () => {
    const roots = createViewerShell(container, createMessages('en'));
    roots.root.style.setProperty('--jeex-backdrop', '#20242a');
    const derived = resolveBackdrop(roots.root);
    expect(derived.horizon).toBe('#20242a');
    expect(new THREE.Color(derived.top).getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(
      new THREE.Color('#20242a').getHSL({ h: 0, s: 0, l: 0 }).l,
    );
    roots.root.style.setProperty('--jeex-backdrop-top', '#445566');
    expect(resolveBackdrop(roots.root).top).toBe('#445566');
  });
});

describe('RenderRuntime.setBackdrop', () => {
  test('repaints the runtime-owned sky in place and recolours the fog', () => {
    const runtime = runtimeIn(openContainer(64, 64));
    const sky = runtime.scene.background as THREE.Texture;
    const fog = runtime.scene.fog as THREE.Fog;
    expect(sky).toBeInstanceOf(THREE.Texture);
    const version = sky.version;

    runtime.setBackdrop({ top: '#506070', horizon: '#20242a' });

    // Same objects: what the HDRI sky saved and will restore is this texture and this fog.
    expect(runtime.scene.background).toBe(sky);
    expect(runtime.scene.fog).toBe(fog);
    expect(sky.version).toBeGreaterThan(version);
    expect(near(skyPixel(sky, 'bottom'), '#20242a')).toBe(true);
    expect(near(skyPixel(sky, 'top'), '#506070')).toBe(true);
    expect(`#${fog.color.getHexString()}`).toBe('#20242a');
  });

  test('walk and tour keep the daylight sky: a backdrop set meanwhile is kept and shown on the way out', () => {
    const runtime = runtimeIn(openContainer(64, 64));
    const sky = runtime.scene.background as THREE.Texture;
    const fog = runtime.scene.fog as THREE.Fog;
    runtime.setBackdrop({ top: '#506070', horizon: '#20242a' });

    runtime.setDaylightSky(true);
    expect(near(skyPixel(sky, 'bottom'), DAYLIGHT_HORIZON)).toBe(true);
    expect(`#${fog.color.getHexString()}`).toBe(DAYLIGHT_HORIZON);
    runtime.setBackdrop({ top: '#304050', horizon: '#101418' });
    expect(near(skyPixel(sky, 'bottom'), DAYLIGHT_HORIZON)).toBe(true);

    runtime.setDaylightSky(false);
    expect(runtime.scene.background).toBe(sky);
    expect(near(skyPixel(sky, 'bottom'), '#101418')).toBe(true);
    expect(`#${fog.color.getHexString()}`).toBe('#101418');
  });

  test('with an HDRI up, the sky it saved changes in place and the live scene is left alone', () => {
    const runtime = runtimeIn(openContainer(64, 64));
    const sky = runtime.scene.background as THREE.Texture;
    const fog = runtime.scene.fog;
    runtime.setBackdrop({ top: '#506070', horizon: '#20242a' });
    // What `HdriSky` does on entering walk: keep the fallback, put its own sky up, drop the fog.
    const hdri = new THREE.Texture();
    runtime.scene.background = hdri;
    runtime.scene.fog = null;

    runtime.setDaylightSky(true);
    expect(runtime.scene.background).toBe(hdri);
    expect(runtime.scene.fog).toBeNull();

    // ...and what it does on leaving: the saved objects go back, themed again.
    runtime.setDaylightSky(false);
    runtime.scene.background = sky;
    runtime.scene.fog = fog;
    expect(near(skyPixel(sky, 'bottom'), '#20242a')).toBe(true);
    expect(`#${(fog as THREE.Fog).color.getHexString()}`).toBe('#20242a');
    hdri.dispose();
  });

  test("another viewer's sky is untouched, and dispose frees the owned sky", () => {
    const first = runtimeIn(openContainer(64, 64));
    const second = runtimeIn(openContainer(64, 64));
    const firstSky = first.scene.background as THREE.Texture;
    const secondSky = second.scene.background as THREE.Texture;
    expect(firstSky).not.toBe(secondSky);

    first.setBackdrop({ top: '#506070', horizon: '#20242a' });
    expect(near(skyPixel(secondSky, 'bottom'), '#20242a')).toBe(false);

    let disposed = false;
    firstSky.addEventListener('dispose', () => {
      disposed = true;
    });
    first.dispose();
    runtimes.splice(runtimes.indexOf(first), 1);
    expect(disposed).toBe(true);
  });
});

describe('a mounted viewer under a dark host backdrop', () => {
  test('walk bakes its room probes from the daylight sky and shows it; leaving walk shows the backdrop again', async () => {
    const style = document.createElement('style');
    style.textContent = `.jeex-viewer { --jeex-backdrop: ${DARK}; --jeex-backdrop-top: ${DARK}; }`;
    document.head.append(style);
    // The live scene, caught when the apartment rig goes onto it, as the walk-lighting tests catch it.
    let scene: THREE.Scene | null = null;
    const add = Object.getOwnPropertyDescriptor(THREE.Object3D.prototype, 'add')!.value as THREE.Object3D['add'];
    const caught = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if ((this as THREE.Scene).isScene && objects.some((object) => object.name === 'jeex-lighting-apartment-rig'))
        scene ??= this as THREE.Scene;
      return add.apply(this, objects);
    });
    // Every grid bake step captures the scene, background and ground included: what it sees is the probes' input.
    const bakedFrom: boolean[] = [];
    const step = Object.getOwnPropertyDescriptor(GridBake.prototype, 'step')!.value as GridBake['step'];
    const baked = vi.spyOn(GridBake.prototype, 'step').mockImplementation(function (this: GridBake) {
      const background = scene?.background as THREE.Texture | null | undefined;
      const ground = scene ? findSiteGround(scene) : null;
      bakedFrom.push(
        background?.isTexture === true &&
          near(skyPixel(background, 'bottom'), DAYLIGHT_HORIZON) &&
          (ground?.material as THREE.Material | undefined)?.type === 'MeshStandardMaterial',
      );
      return step.call(this);
    });
    const handle = mountViewer(openContainer(480, 320), {
      scene: { repository: new InlineSceneRepository(demoScene()) },
      tour: { mode: 'off' },
      doors: { autoOpen: false },
    });
    try {
      await handle.ready;
      await until(() => scene !== null, 'the live scene', 60_000);
      caught.mockRestore();
      const sky = scene!.background as THREE.Texture;
      await until(() => near(skyPixel(sky, 'bottom'), DARK), 'the dark backdrop in 360', 30_000);

      handle.setMode('walk');
      await until(() => bakedFrom.length > 0, 'the first bake step', 120_000);
      expect(bakedFrom.every(Boolean)).toBe(true);
      expect(near(skyPixel(sky, 'bottom'), DAYLIGHT_HORIZON)).toBe(true);

      handle.setMode('orbit');
      await until(() => near(skyPixel(sky, 'bottom'), DARK), 'the dark backdrop back in 360', 30_000);
    } finally {
      handle.dispose();
      caught.mockRestore();
      baked.mockRestore();
      style.remove();
    }
  }, 300_000);

  test('a camera-view capture taken from 360 looks out at the daylight sky; a still of the live view keeps the backdrop', async () => {
    const style = document.createElement('style');
    style.textContent = `.jeex-viewer { --jeex-backdrop: ${DARK}; --jeex-backdrop-top: ${DARK}; }`;
    document.head.append(style);
    let scene: THREE.Scene | null = null;
    const add = Object.getOwnPropertyDescriptor(THREE.Object3D.prototype, 'add')!.value as THREE.Object3D['add'];
    const caught = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if ((this as THREE.Scene).isScene && objects.some((object) => object.name === 'jeex-lighting-apartment-rig'))
        scene ??= this as THREE.Scene;
      return add.apply(this, objects);
    });
    // Every scene drawn into a target of its own is a capture here (360 draws no probes and no chain):
    // whether the sky it drew was the daylight one and the ground its lit self.
    let seen: boolean[] = [];
    const before = Object.getOwnPropertyDescriptor(THREE.Object3D.prototype, 'onBeforeRender')!.value as THREE.Object3D['onBeforeRender'];
    const drawn = vi.spyOn(THREE.Object3D.prototype, 'onBeforeRender').mockImplementation(function (this: THREE.Object3D, ...args) {
      const background = (this as THREE.Scene).isScene ? (this as THREE.Scene).background : null;
      if (background instanceof THREE.Texture && background === scene?.background && args[3] !== null) {
        const ground = findSiteGround(this);
        const lit = (ground?.material as THREE.Material | undefined)?.type === 'MeshStandardMaterial';
        seen.push(near(skyPixel(background, 'bottom'), DAYLIGHT_HORIZON) && lit);
      }
      before.apply(this, args);
    });
    const handle = mountViewer(openContainer(480, 320), {
      scene: { repository: new InlineSceneRepository(structuredClone(lShapePlan)) },
      tour: { mode: 'off' },
    });
    try {
      await handle.ready;
      await until(() => scene !== null, 'the live scene', 60_000);
      const sky = scene!.background as THREE.Texture;
      await until(() => near(skyPixel(sky, 'bottom'), DARK), 'the dark backdrop in 360', 30_000);

      await handle.capture.still({ width: 64, height: 48, camera: 'presentation', caption: false });
      await handle.capture.still({ width: 64, height: 48, camera: 'presentation', state: 'default', caption: false });
      await handle.capture.panorama({ width: 64, roomId: L_SHAPE.room.a, caption: false });
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every(Boolean)).toBe(true);
      expect(near(skyPixel(sky, 'bottom'), DARK)).toBe(true);

      seen = [];
      await handle.capture.still({ width: 64, height: 48, camera: 'live', caption: false });
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.some(Boolean)).toBe(false);
    } finally {
      handle.dispose();
      caught.mockRestore();
      drawn.mockRestore();
      style.remove();
    }
  }, 300_000);
});

describe('the picture a mounted viewer draws in 360', () => {
  /**
   * Polls the viewer's top-left corner, as the compositor shows it (the page
   * screenshot: what a visitor sees, canvas and CSS together), until it is
   * `hex`. Each poll asks for a picture (`refreshTheme` repaints the sky and
   * invalidates a resting view). The last colour seen is in the failure.
   */
  async function untilCorner(handle: { refreshTheme(): void }, host: HTMLElement, hex: string, what: string): Promise<void> {
    const deadline = performance.now() + 30_000;
    let seen: [number, number, number] | null = null;
    while (seen === null || !near(seen, hex, 24)) {
      if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}; the corner is rgb(${seen?.join(', ')})`);
      handle.refreshTheme();
      await nextFrame();
      await nextFrame();
      const png = await page.screenshot({ save: false });
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const box = host.getBoundingClientRect();
      const scale = bitmap.width / window.innerWidth;
      const read = new OffscreenCanvas(1, 1).getContext('2d')!;
      read.drawImage(bitmap, Math.round((box.left + 4) * scale), Math.round((box.top + 4) * scale), 1, 1, 0, 0, 1, 1);
      bitmap.close();
      const [r, g, b] = read.getImageData(0, 0, 1, 1).data;
      seen = [r!, g!, b!];
    }
  }

  test('around the model it is the backdrop the host set, and refreshTheme repaints it', async () => {
    const host = openContainer(480, 320);
    // The options an embed that names only its scene gets, over the demo flat a landing shows.
    const handle = mountViewer(host, { scene: { repository: new InlineSceneRepository(demoScene()) } });
    try {
      await handle.ready;
      await untilCorner(handle, host, '#303640', 'the neutral backdrop around the model');

      host.querySelector<HTMLElement>('.jeex-viewer')!.style.setProperty('--jeex-backdrop', 'red');
      await untilCorner(handle, host, '#ff0000', 'the red backdrop around the model');
    } finally {
      handle.dispose();
    }
  }, 300_000);
});

describe('the plinth under the model', () => {
  test('reads neutral grey in 360, on the graphite default as on any theme', async () => {
    let scene: THREE.Scene | null = null;
    const add = Object.getOwnPropertyDescriptor(THREE.Object3D.prototype, 'add')!.value as THREE.Object3D['add'];
    const caught = vi.spyOn(THREE.Object3D.prototype, 'add').mockImplementation(function (this: THREE.Object3D, ...objects) {
      if ((this as THREE.Scene).isScene && objects.some((object) => object.name === 'jeex-lighting-apartment-rig'))
        scene ??= this as THREE.Scene;
      return add.apply(this, objects);
    });
    const host = openContainer(960, 540);
    const handle = mountViewer(host, { scene: { repository: new InlineSceneRepository(demoScene()) }, debug: true });
    try {
      await handle.ready;
      await until(() => scene?.getObjectByName('site-slab') !== undefined, 'the plinth', 60_000);
      caught.mockRestore();
      const debug = (
        window as unknown as { __viewerDebug: { projectPoint(x: number, y: number, z: number): { x: number; y: number } | null } }
      ).__viewerDebug;
      const canvas = host.querySelector<HTMLCanvasElement>('[data-jeex="scene-canvas"]')!;
      // The slab's top, on the strip it shows in front of the walls (the presentation camera looks from −z).
      const box = new THREE.Box3().setFromObject(scene!.getObjectByName('site-slab')!);
      const at = debug.projectPoint((box.min.x + box.max.x) / 2, box.max.y, box.min.z + 0.25)!;
      const rect = canvas.getBoundingClientRect();
      let seen: [number, number, number] = [0, 0, 0];
      for (let attempt = 0; attempt < 60; attempt += 1) {
        handle.refreshTheme();
        await nextFrame();
        await nextFrame();
        const png = await page.screenshot({ save: false });
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
        const scale = bitmap.width / window.innerWidth;
        const read = new OffscreenCanvas(1, 1).getContext('2d')!;
        read.drawImage(bitmap, Math.round((rect.left + at.x) * scale), Math.round((rect.top + at.y) * scale), 1, 1, 0, 0, 1, 1);
        bitmap.close();
        const [r, g, b] = read.getImageData(0, 0, 1, 1).data;
        seen = [r!, g!, b!];
        // A frame that drew nothing reads black: poll until the plinth is on screen.
        if (Math.max(...seen) > 60) break;
      }
      // Neutral: no channel apart from another by more than a sun-warmed grey shows (the tan read 53 red over blue).
      const [r, g, b] = seen;
      expect(Math.max(r, g, b) - Math.min(r, g, b), `the plinth reads rgb(${seen.join(', ')})`).toBeLessThanOrEqual(16);
    } finally {
      handle.dispose();
      caught.mockRestore();
    }
  }, 300_000);
});

describe('theme tokens', () => {
  test('the backdrop, backdrop top, on-accent and state surface are documented theme properties', () => {
    expect(THEME_PROPERTIES).toEqual(
      expect.arrayContaining(['--jeex-backdrop', '--jeex-backdrop-top', '--jeex-on-accent', '--jeex-state-surface']),
    );
  });

  test('an accent override alone recolours every accent-coloured element; no former gold is left', () => {
    const roots = createViewerShell(container, createMessages('en'));
    roots.root.style.setProperty('--jeex-accent', 'rgb(79, 140, 255)');
    const style = getComputedStyle(roots.root);
    for (const derived of ['--jeex-accent-strong', '--jeex-accent-muted', '--jeex-focus']) {
      const probe = document.createElement('span');
      probe.style.color = `var(${derived})`;
      roots.root.appendChild(probe);
      const colour = getComputedStyle(probe).color;
      expect(FORMER_GOLD, `${derived} = ${style.getPropertyValue(derived)}`).not.toContain(colour);
      probe.remove();
    }
    const mark = roots.root.querySelector<HTMLElement>('.loading-mark span')!;
    expect(FORMER_GOLD).not.toContain(getComputedStyle(mark).backgroundColor);
  });

  test('the strong and muted shades follow the accent in both schemes', () => {
    const roots = createViewerShell(container, createMessages('en'));
    roots.root.style.setProperty('--jeex-accent', 'rgb(79, 140, 255)');
    const shade = (name: string): string => {
      const probe = document.createElement('span');
      probe.style.color = `var(${name})`;
      roots.root.appendChild(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    };
    for (const scheme of ['light', 'dark']) {
      roots.root.style.setProperty('--jeex-color-scheme', scheme);
      const strong = shade('--jeex-accent-strong');
      const muted = shade('--jeex-accent-muted');
      expect(strong, scheme).not.toBe(shade('--jeex-accent'));
      expect(muted, scheme).not.toBe(shade('--jeex-accent'));
      roots.root.style.setProperty('--jeex-accent', 'rgb(200, 40, 40)');
      expect(shade('--jeex-accent-strong'), scheme).not.toBe(strong);
      roots.root.style.setProperty('--jeex-accent', 'rgb(79, 140, 255)');
    }
  });

  test('the default accent keeps its on-accent text readable in both schemes (WCAG AA for UI text, 4.5:1)', () => {
    const roots = createViewerShell(container, createMessages('en'));
    const luminance = (css: string): number => {
      const [r, g, b] = (css.match(/\d+(\.\d+)?/g) ?? [])
        .slice(0, 3)
        .map(Number)
        .map((c) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    for (const scheme of ['light', 'dark']) {
      roots.root.style.setProperty('--jeex-color-scheme', scheme);
      const probe = document.createElement('span');
      probe.style.color = 'var(--jeex-on-accent)';
      probe.style.backgroundColor = 'var(--jeex-accent)';
      roots.root.appendChild(probe);
      const style = getComputedStyle(probe);
      const [a, b] = [luminance(style.color), luminance(style.backgroundColor)].sort((x, y) => y - x);
      expect((a! + 0.05) / (b! + 0.05), scheme).toBeGreaterThanOrEqual(4.5);
      probe.remove();
    }
  });

  test('the loading and error cards paint --jeex-state-surface', () => {
    const roots = createViewerShell(container, createMessages('en'));
    roots.root.style.setProperty('--jeex-state-surface', 'rgb(1, 2, 3)');
    for (const card of roots.root.querySelectorAll<HTMLElement>('.loading-state, .state-card')) {
      expect(getComputedStyle(card).backgroundColor, card.className).toBe('rgb(1, 2, 3)');
      expect(getComputedStyle(card).backgroundImage, card.className).toBe('none');
    }
  });

  test('the defaults are neutral: no beige backdrop, no gold accent', () => {
    const roots = createViewerShell(container, createMessages('en'));
    expect(getComputedStyle(roots.root).backgroundColor).not.toBe(FORMER_BEIGE);
    expect(getComputedStyle(roots.root).backgroundColor).toBe('rgb(48, 54, 64)');
    const active = roots.root.querySelector<HTMLElement>('.mode-button.is-active')!;
    expect(FORMER_GOLD).not.toContain(getComputedStyle(active).backgroundColor);
  });
});
