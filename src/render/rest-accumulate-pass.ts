/**
 * The pass that turns the rest frames of a resting walk or tour view into
 * their running mean (`rest-accumulation.ts`), in the walk chain between the
 * occlusion and SMAA (`walk-post.ts`), so it averages the linear high dynamic
 * range picture and the output pass applies the white balance and the display
 * transform to the mean once.
 *
 * Mean invariant: after rest frame `frame` (from 0) the pass holds, and hands
 * on, the mean of the pictures of frames 0 to `frame`; frame 0 copies its
 * picture and forgets everything before it. The mean lives in two half-float
 * targets of its own (one read, one written, then swapped), never in the
 * composer's buffers.
 *
 * Allocation invariant: a rest frame allocates nothing. Both targets are sized
 * and given their GPU textures by `allocate`, which the chain calls on a draw
 * that answers a change (the first after construction, a live size change),
 * so the settle window that new GPU resources open (`settle-window.ts`) opens
 * there and never inside a burst. A capture that resizes the chain
 * (`WalkPost.renderTo`, which runs without this pass) leaves the targets and
 * the mean alone.
 *
 * Loaded only with the walk chunk: like `walk-post.ts`, it imports three's
 * post-processing addons.
 */

import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { restMeanWeight } from './rest-accumulation.js';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

/** The mean so far and one more sample, by its weight (`restMeanWeight`). */
const BLEND = /* glsl */ `
uniform sampler2D tMean;
uniform sampler2D tSample;
uniform float weight;
varying vec2 vUv;
void main() {
  gl_FragColor = mix( texture2D( tMean, vUv ), texture2D( tSample, vUv ), weight );
}`;

const COPY = /* glsl */ `
uniform sampler2D tSample;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D( tSample, vUv );
}`;

export class RestAccumulatePass extends Pass {
  /** The rest frame the next `render` adds, from 0. */
  frame = 0;
  private readonly targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  /** Which of `targets` holds the mean. */
  private current = 0;
  private readonly blend: THREE.ShaderMaterial;
  private readonly copy: THREE.ShaderMaterial;
  private readonly quad = new FullScreenQuad();

  constructor() {
    super();
    const target = (): THREE.WebGLRenderTarget => {
      const made = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
      made.texture.name = 'RestAccumulatePass.mean';
      return made;
    };
    this.targets = [target(), target()];
    this.blend = new THREE.ShaderMaterial({
      uniforms: { tMean: { value: null }, tSample: { value: null }, weight: { value: 1 } },
      vertexShader: VERTEX,
      fragmentShader: BLEND,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.copy = new THREE.ShaderMaterial({
      uniforms: { tSample: { value: null } },
      vertexShader: VERTEX,
      fragmentShader: COPY,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
  }

  /** The target holding the mean of the rest frames drawn so far. */
  get mean(): THREE.WebGLRenderTarget {
    return this.targets[this.current]!;
  }

  /**
   * Sizes both targets to `width` x `height` and allocates their textures on
   * `renderer` now, so the rest frames that follow draw into what exists;
   * nothing when they already have that size.
   */
  allocate(renderer: THREE.WebGLRenderer, width: number, height: number): void {
    const [first, second] = this.targets;
    if (first.width === width && first.height === height) return;
    for (const target of this.targets) target.setSize(width, height);
    renderer.initRenderTarget(first);
    renderer.initRenderTarget(second);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const next = this.targets[1 - this.current]!;
    if (this.frame === 0) {
      this.draw(renderer, this.copy, { tSample: readBuffer.texture }, next);
    } else {
      this.draw(renderer, this.blend, { tMean: this.mean.texture, tSample: readBuffer.texture, weight: restMeanWeight(this.frame) }, next);
    }
    this.current = 1 - this.current;
    this.draw(renderer, this.copy, { tSample: this.mean.texture }, this.renderToScreen ? null : writeBuffer);
  }

  override dispose(): void {
    for (const target of this.targets) target.dispose();
    this.blend.dispose();
    this.copy.dispose();
    this.quad.dispose();
  }

  private draw(
    renderer: THREE.WebGLRenderer,
    material: THREE.ShaderMaterial,
    uniforms: Record<string, unknown>,
    target: THREE.WebGLRenderTarget | null,
  ): void {
    for (const [name, value] of Object.entries(uniforms)) material.uniforms[name]!.value = value;
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }
}
