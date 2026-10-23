/**
 * One `CameraController` over a fixture plan, and the few helpers every camera
 * suite measures with.
 *
 * `camera-controller.test.ts` was 1837 lines because it owned the harness AND
 * the behaviour of all three rigs. The behaviour has
 * moved to `orbit-rig.test.ts`, `walk-rig.test.ts`, `walk-doors.test.ts` and
 * `travel-rig.test.ts`, which is where a reader looks for it; this file is what
 * they share, so the split did not become four copies of the same 130 lines.
 *
 * The controller rather than the rig is what those suites drive on purpose:
 * a rig's contract is with the controller (spawn, collision, the door gate),
 * and a test that constructs a rig directly asserts a wiring no production
 * path uses.
 */

import { expect } from 'bun:test';
import * as THREE from 'three';
import { CameraController } from '../camera/camera-controller.js';
import { Picker } from '../geometry/picker.js';
import { solvePlan, type SolvedPlan } from '../plan/plan-solver.js';
import { EYE_HEIGHT_M } from '../navigation/navigation.js';
import { lShapePlan } from './plan-l-shape.js';
import { collectLog, fakeCanvas, type FakeCanvas } from './stubs.js';
import { createLogger, type LogEntry } from '../shared/logger.js';
import type { MessageKey } from '../ui/messages.js';
import type { SceneData } from '../scene/types.js';
import type { AssetFactsSource } from '../assets/asset-facts.js';

/**
 * Eye height the controller snaps to in walk mode.
 *
 * Re-exported, never re-declared: `camera-tuning.test.ts` fails any module
 * under `src/` that writes the number again: guards against the router proving
 * its legs at one copy of it while the walk rig snaps to another.
 */
export const EYE_HEIGHT = EYE_HEIGHT_M;
/** One frame at 60 Hz, in seconds: the step every `update` loop here uses. */
export const FRAME = 1 / 60;
/** Pace of a scripted travel (`camera-controller.ts` `TRAVEL_SPEED`), m/s. */
export const TRAVEL_SPEED = 1.8;

export type CameraHarness = {
  controller: CameraController;
  camera: THREE.PerspectiveCamera;
  canvas: FakeCanvas;
  /** The controller's own picker, so a test can give it a floor to tap on. */
  picker: Picker;
  /** Hint KEYS the controller emitted, newest last; the owner resolves them. */
  hints: MessageKey[];
  /**
   * Everything the controller reported through its `onLog` sink, newest last.
   * It is the harness's own sink, so nothing leaks between tests and a throwing
   * test restores nothing (`stubs.collectLog`).
   */
  warnings: LogEntry[];
};

export type CameraHarnessOptions = {
  closedDoors?: (() => ReadonlySet<string>) | undefined;
  lockedDoors?: (() => ReadonlySet<string>) | undefined;
  rearmDoor?: ((openingId: string) => boolean) | undefined;
  scene?: SceneData;
  /** The document's bank for the walk obstacles; absent is the shipped bank. */
  assetFacts?: (() => AssetFactsSource) | undefined;
  /** Where the controller reports manual input; the director's business, so a no-op by default. */
  onManualInput?: (() => void) | undefined;
  /** `options.interaction`; default `'full'`, as the resolver's is. */
  interaction?: 'full' | 'none' | 'passive' | undefined;
};

/** A controller over `lShapePlan` (or the scene given), freshly reset. */
export function cameraHarness(options: CameraHarnessOptions = {}): CameraHarness {
  const camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 200);
  const canvas = fakeCanvas();
  const scene = options.scene ?? lShapePlan;
  const plan = solvePlan(scene);
  const hints: MessageKey[] = [];
  const logged = collectLog();
  // `Picker` declares only the members it uses, so the stub satisfies it
  // structurally; `CameraController` names `HTMLCanvasElement` and needs the
  // one cast this file carries.
  const picker = new Picker(canvas);
  const controller = new CameraController(camera, canvas as unknown as HTMLCanvasElement, scene, plan, picker, {
    keys: canvas as unknown as HTMLElement,
    onManualInput: () => {
      // Manual input is the director's business, not the controller's; the
      // suites that care about it pass their own sink.
      options.onManualInput?.();
    },
    onHint: (message) => {
      hints.push(message);
    },
    closedDoors: options.closedDoors,
    lockedDoors: options.lockedDoors,
    rearmDoor: options.rearmDoor,
    assetFacts: options.assetFacts,
    interaction: options.interaction,
    log: createLogger(logged.sink),
  });
  return { controller, camera, canvas, picker, hints, warnings: logged.entries };
}

/**
 * The camera is where it should be, to `digits` decimal places.
 *
 * `bun:test`'s `expect` is imported here rather than passed in: this file is
 * test support, it is never in a production graph (`tsconfig.lib.json` emits
 * from `files`, and nothing under `src/` outside a test imports `fixtures/`),
 * and threading the matcher through every call site would be ceremony.
 */
export function expectPosition(camera: THREE.PerspectiveCamera, x: number, y: number, z: number, digits = 6): void {
  expect(camera.position.x).toBeCloseTo(x, digits);
  expect(camera.position.y).toBeCloseTo(y, digits);
  expect(camera.position.z).toBeCloseTo(z, digits);
}

/** Mid-point of the first door interval of a wall centreline, in plan metres. */
export function doorwayCentre(plan: SolvedPlan, wallId: string): { x: number; z: number } | null {
  const line = plan.centrelines.find((candidate) => candidate.wallId === wallId && candidate.doors.length > 0);
  if (!line) return null;
  const door = line.doors[0]!;
  const at = (door.t0 + door.t1) / 2;
  let travelled = 0;
  for (let i = 0; i + 1 < line.polyline.length; i += 1) {
    const a = line.polyline[i]!;
    const b = line.polyline[i + 1]!;
    const segment = Math.hypot(b.x - a.x, b.z - a.z);
    if (travelled + segment >= at) {
      const k = (at - travelled) / segment;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
    }
    travelled += segment;
  }
  return null;
}
