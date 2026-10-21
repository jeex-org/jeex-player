/**
 * How every headless Chromium this repository launches gets a WebGL2 context:
 * the Playwright e2e suite (`playwright.config.ts`), the Vitest browser level
 * (`vitest.config.ts`) and `scripts/video-frames.ts`. One module, so the three
 * cannot drift apart, and the two machine knobs below are read in one place.
 *
 * The DEFAULT is the software rasteriser, exactly as before: SwiftShader
 * through ANGLE, from Chromium's own SwiftShader doc
 * (<https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/gpu/swiftshader.md>).
 * `--enable-unsafe-swiftshader` is not optional: the
 * silent fallback to the software rasteriser was deprecated, and without the
 * flag `canvas.getContext('webgl2')` returns `null` on a machine with no GPU —
 * which is every CI runner.
 *
 * Two knobs, both unset on CI and on macOS, both for machines whose
 * software path is too slow for the suites' frame-bound waits. Both browser
 * tiers (Vitest browser mode and Playwright) read them through this one
 * function, so a gate renders both on the same path:
 *
 * - `JEEX_E2E_ANGLE=swiftshader` keeps the software rasteriser but composites
 *   without the per-frame read-back of `swiftshader-webgl` (the default).
 *   Measured on a machine without a GPU exposed to Chromium (headless shell):
 *   1.1-1.2 fps with the default, 2.4-3.1 fps with this one, the same
 *   `SwiftShader Device (Subzero)` renderer string and the same WebGL pixels
 *   (a baseline set generated with one passed against the other).
 * - `JEEX_BROWSER_GPU=d3d12` renders on the host GPU through WSL2's `/dev/dxg`
 *   and Mesa's D3D12 Gallium driver: 60 fps (rAF-capped) with correct pixels,
 *   renderer `ANGLE (Microsoft Corporation, D3D12 (…), OpenGL ES 3.1)`.
 *   Every part is required: the FULL Chromium (`channel: 'chromium'`, new
 *   headless) — the headless shell silently falls back to SwiftShader and
 *   draws nothing; no GPU-process sandbox, which blocks `/dev/dxg`; ANGLE's
 *   `gl` back end (`gles` and `--use-gl=egl` hang); the Mesa overrides; and
 *   `/usr/lib/wsl/lib` on the library path. `MESA_D3D12_DEFAULT_ADAPTER_NAME`
 *   is deliberately NOT set: pinning the NVIDIA adapter hangs, and the
 *   integrated one is enough.
 * - `JEEX_BROWSER_GPU=nvidia` renders on an NVIDIA GPU of a native Linux host
 *   with no display server: ANGLE's `gl-egl` back end on NVIDIA's surfaceless
 *   EGL, in Playwright's default headless shell (no full Chromium, no sandbox
 *   change). Where NVIDIA's EGL vendor file is missing (a CI runner, a
 *   machine without the driver) the knob falls back to SwiftShader with a
 *   one-line note instead of handing Chromium a GPU path that would draw
 *   nothing. Gate timings with it: Vitest browser tier about 65 s
 *   against about 6 min on SwiftShader, Playwright about 1 min against about
 *   20 min. The `linux` screenshot baselines pass on both renderers unchanged:
 *   the chrome baselines mask the canvas, and the canvas baselines'
 *   `CANVAS_DIFF_RATIO` absorbs the rasteriser difference. Measured on a
 *   native Linux host with an NVIDIA GPU: 60 fps (rAF-capped, ~3700 uncapped)
 *   with correct pixels in the headless shell, renderer
 *   `ANGLE (NVIDIA Corporation, NVIDIA GeForce <model>/PCIe/SSE2, OpenGL ES 3.2)`.
 *   `--use-angle=gl` opens the default (X11) EGL display and falls back to
 *   SwiftShader; without the glvnd vendor pin Mesa takes the display and the
 *   integrated GPU renders instead.
 */

import { existsSync } from 'node:fs';

/** What `chromium.launch` needs to get WebGL2 on the current machine. */
export type HeadlessWebglLaunch = {
  channel?: string;
  args: string[];
  env?: Record<string, string>;
};

/** NVIDIA's glvnd EGL vendor file (the `libEGL_nvidia.so.0` ICD). */
const NVIDIA_EGL_VENDOR = '/usr/share/glvnd/egl_vendor.d/10_nvidia.json';

/** WSL2's user-mode GPU libraries (`libd3d12.so`, `libdxcore.so`). */
const WSL_GPU_LIBRARIES = '/usr/lib/wsl/lib';

/**
 * The player sends anonymous telemetry to this host by default. Every test
 * browser resolves it to nothing, so no test, screenshot or poster run can
 * ever reach the production endpoint; a spec that asserts sends intercepts
 * the request, which happens before name resolution.
 */
export const TELEMETRY_HOST_RULE = '--host-resolver-rules=MAP telemetry.jeex.org ~NOTFOUND';

/**
 * The launch options for the configured WebGL path (module comment). The
 * environment and the driver probe are parameters so the decision is testable
 * without a GPU; every caller passes neither.
 */
export function headlessWebglLaunch(
  env: NodeJS.ProcessEnv = process.env,
  hasNvidiaEgl: () => boolean = () => existsSync(NVIDIA_EGL_VENDOR),
): HeadlessWebglLaunch {
  const launch = rendererLaunch(env, hasNvidiaEgl);
  return { ...launch, args: [...launch.args, TELEMETRY_HOST_RULE] };
}

function rendererLaunch(env: NodeJS.ProcessEnv, hasNvidiaEgl: () => boolean): HeadlessWebglLaunch {
  const gpu = env['JEEX_BROWSER_GPU'];
  if (gpu === undefined || gpu === '') return softwareLaunch(env);
  if (gpu !== 'd3d12' && gpu !== 'nvidia') throw new Error(`JEEX_BROWSER_GPU must be unset, d3d12 or nvidia, got ${gpu}`);
  const inherited = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  if (gpu === 'nvidia') {
    if (!hasNvidiaEgl()) {
      process.stderr.write(`JEEX_BROWSER_GPU=nvidia: ${NVIDIA_EGL_VENDOR} is missing, rendering on SwiftShader\n`);
      return softwareLaunch(env);
    }
    return {
      args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'],
      env: { ...inherited, EGL_PLATFORM: 'surfaceless', __EGL_VENDOR_LIBRARY_FILENAMES: NVIDIA_EGL_VENDOR },
    };
  }
  const libraryPath = env['LD_LIBRARY_PATH'];
  return {
    channel: 'chromium',
    args: ['--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'],
    env: {
      ...inherited,
      MESA_LOADER_DRIVER_OVERRIDE: 'd3d12',
      GALLIUM_DRIVER: 'd3d12',
      EGL_PLATFORM: 'surfaceless',
      LD_LIBRARY_PATH: libraryPath ? `${WSL_GPU_LIBRARIES}:${libraryPath}` : WSL_GPU_LIBRARIES,
    },
  };
}

/** SwiftShader through ANGLE, the default and the fallback. */
function softwareLaunch(env: NodeJS.ProcessEnv): HeadlessWebglLaunch {
  return { args: ['--use-gl=angle', `--use-angle=${softwareAngle(env)}`, '--enable-unsafe-swiftshader'] };
}

/** The software ANGLE back end, `swiftshader-webgl` unless `JEEX_E2E_ANGLE` names the other. */
function softwareAngle(env: NodeJS.ProcessEnv): string {
  const value = env['JEEX_E2E_ANGLE'] ?? 'swiftshader-webgl';
  if (value !== 'swiftshader-webgl' && value !== 'swiftshader') {
    throw new Error(`JEEX_E2E_ANGLE must be swiftshader-webgl or swiftshader, got ${value}`);
  }
  return value;
}
