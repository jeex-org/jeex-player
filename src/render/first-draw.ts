/**
 * The first picture of a started loop: when it may be drawn, and who hears
 * that it was.
 *
 * three compiles and links a material's program the first time the material
 * is drawn, synchronously, so the first display draw of a scene used to wait
 * for every link in one long task. `FirstDrawGate` holds that draw until the
 * scene's programs were compiled asynchronously (`renderer.compileAsync`,
 * which links in parallel off the main thread where the browser has
 * `KHR_parallel_shader_compile`), or until `FIRST_DRAW_BOUND_MS` passed, so
 * a driver that never reports readiness cannot keep the view blank. A
 * rejection, a throw or a renderer without asynchronous compilation opens the
 * gate at once. Only the latest arming counts: a compilation started for an
 * earlier `start()` never opens a later one.
 *
 * `FirstDrawSignal` is the one-shot «the first picture is on screen» a
 * started loop owes its owner: the viewer's `ready`, its app-ready flag and
 * its reveal wait on it. Re-armed on every `start()`, so a context restore
 * announces its own first picture.
 *
 * Pure: no `three` and no DOM; timers are injected.
 */

/** Longest wait for compilation before the first display draw, ms. */
export const FIRST_DRAW_BOUND_MS = 1000;

/** The timer functions the gate runs on (the window's in production). */
export type GateTimers = {
  setTimeout: (run: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
};

export class FirstDrawGate {
  private readonly timers: GateTimers;
  private generation = 0;
  private timer: number | null = null;
  private opened = true;

  constructor(timers: GateTimers) {
    this.timers = timers;
  }

  /** Whether the first display draw may happen. */
  get open(): boolean {
    return this.opened;
  }

  /**
   * Closes the gate until `compile` settles or the bound passes. `null` (no
   * asynchronous compilation) and a `compile` that throws leave it open.
   */
  arm(compile: (() => Promise<unknown>) | null): void {
    this.generation += 1;
    const generation = this.generation;
    this.clearTimer();
    if (compile === null) {
      this.opened = true;
      return;
    }
    let pending: Promise<unknown>;
    try {
      pending = compile();
    } catch {
      this.opened = true;
      return;
    }
    this.opened = false;
    const release = (): void => {
      if (generation !== this.generation) return;
      this.opened = true;
      this.clearTimer();
    };
    this.timer = this.timers.setTimeout(release, FIRST_DRAW_BOUND_MS);
    pending.then(release, release);
  }

  private clearTimer(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}

export class FirstDrawSignal {
  private resolve: (() => void) | null = null;
  private current: Promise<void> = Promise.resolve();

  /** A new first picture is owed (the loop started). */
  arm(): void {
    if (this.resolve !== null) return;
    this.current = new Promise<void>((resolve) => {
      this.resolve = resolve;
    });
  }

  /** A display draw happened: the owed first picture, if any, is on screen. */
  drawn(): void {
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.();
  }

  /** Resolves once the first picture since the last `arm` is drawn; at once when none is owed. */
  get next(): Promise<void> {
    return this.current;
  }
}
