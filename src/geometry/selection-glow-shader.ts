/**
 * GLSL of the selection aura: the proxy-box vertex shader that hands the
 * fragment stage an orthonormal world frame, and the fragment shader that ray
 * marches a signed-distance density field inside that box.
 *
 * Kept apart from `selection-glow.ts` because it is source text, not logic:
 * every tunable reaches it as a uniform or a `define`, never as a template
 * interpolation. Comments here must stay backtick-free — a backtick inside a
 * shader comment terminates the TypeScript template literal.
 */

export const VERTEX_SHADER = /* glsl */ `
  attribute vec3 aProxyHalf;
  attribute vec3 aCoreHalf;
  attribute vec3 aCenterLocal;
  attribute float aCoreRadius;

  varying vec3 vWorldPos;
  varying vec3 vCenter;
  varying vec3 vCenterLocal;
  varying vec3 vAxisX;
  varying vec3 vAxisY;
  varying vec3 vAxisZ;
  varying vec3 vProxyHalf;
  varying vec3 vCoreHalf;
  varying float vCoreRadius;
  varying float vScale;

  void main() {
    // The envelope is axis-aligned in its own object space and only ever uniformly scaled, so its
    // world frame is three orthonormal axes plus one scale — everything the ray march needs to
    // work in metres, without inverting a matrix per fragment.
    vec3 axisX = (modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
    vec3 axisY = (modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    vec3 axisZ = (modelMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
    float scale = max(length(axisX), 1e-5);
    vScale = scale;
    vAxisX = axisX / scale;
    vAxisY = axisY / max(length(axisY), 1e-5);
    vAxisZ = axisZ / max(length(axisZ), 1e-5);
    vProxyHalf = aProxyHalf * scale;
    vCoreHalf = aCoreHalf * scale;
    vCoreRadius = aCoreRadius * scale;
    vCenterLocal = aCenterLocal;
    vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uOrigin;
  uniform float uSweepLength;
  uniform vec3 uSweepAxis;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uFeather;
  uniform float uAbsorption;
  uniform float uPeakOpacity;
  uniform float uNoiseScale;
  uniform float uNoiseSpeed;
  uniform float uHazeDensity;
  uniform float uDriftGain;
  uniform float uDriftSpeed;
  uniform float uHueSpeed;
  uniform float uHueScale;
  uniform float uBreathSpeed;
  uniform float uBreathDepth;
  uniform float uBloom;
  uniform float uVeil;
  uniform float uOcclusionSoftness;
  uniform int uSolidCount;
  uniform vec3 uSolidCenter[SOLID_MAX];
  uniform vec3 uSolidHalf[SOLID_MAX];

  varying vec3 vWorldPos;
  varying vec3 vCenter;
  varying vec3 vCenterLocal;
  varying vec3 vAxisX;
  varying vec3 vAxisY;
  varying vec3 vAxisZ;
  varying vec3 vProxyHalf;
  varying vec3 vCoreHalf;
  varying float vCoreRadius;
  varying float vScale;

  // Cheap hash -> value noise. No textures, no derivatives.
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash13(i);
    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z);
  }

  // Signed distance to the slightly rounded core envelope, in metres.
  float coreDistance(vec3 p) {
    vec3 q = abs(p) - max(vCoreHalf - vec3(vCoreRadius), vec3(0.0));
    return length(max(q, vec3(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - vCoreRadius;
  }

  // How far the ray runs inside the furniture itself, in metres, taking the deepest of the merged
  // boxes the aura was built from. A *length* rather than a hit test on purpose: it eases to zero
  // as the ray grazes a box, so nothing ever traces that box's outline across empty space.
  float objectChord(vec3 localOrigin, vec3 localDir) {
    float deepest = 0.0;
    for (int j = 0; j < SOLID_MAX; j += 1) {
      if (j >= uSolidCount) break;
      vec3 tA = (uSolidCenter[j] - uSolidHalf[j] - localOrigin) / localDir;
      vec3 tB = (uSolidCenter[j] + uSolidHalf[j] - localOrigin) / localDir;
      vec3 lo = min(tA, tB);
      vec3 hi = max(tA, tB);
      float enter = max(max(max(lo.x, lo.y), lo.z), 0.0);
      float leave = min(min(hi.x, hi.y), hi.z);
      deepest = max(deepest, max(0.0, leave - enter));
    }
    // The slab test runs in local units; the caller works in metres.
    return deepest * vScale;
  }

  // Cyclic three-stop gradient: A -> B -> C -> A.
  vec3 iridescent(float t) {
    float x = fract(t) * 3.0;
    if (x < 1.0) return mix(uColorA, uColorB, smoothstep(0.0, 1.0, x));
    if (x < 2.0) return mix(uColorB, uColorC, smoothstep(0.0, 1.0, x - 1.0));
    return mix(uColorC, uColorA, smoothstep(0.0, 1.0, x - 2.0));
  }

  void main() {
    vec3 rayDir = normalize(vWorldPos - cameraPosition);
    vec3 toCamera = cameraPosition - vCenter;
    // Ray in the envelope's own frame; the axes are orthonormal, so t stays in metres.
    vec3 rayOrigin = vec3(dot(toCamera, vAxisX), dot(toCamera, vAxisY), dot(toCamera, vAxisZ));
    vec3 dir = vec3(dot(rayDir, vAxisX), dot(rayDir, vAxisY), dot(rayDir, vAxisZ));

    // The proxy is drawn double-sided so it survives the camera walking into it; exactly one of
    // its two surfaces may shade the ray, or the mist would be integrated twice.
    bool inside = all(lessThan(abs(rayOrigin), vProxyHalf));
    if (gl_FrontFacing == inside) discard;

    // Never divide by zero: a ray parallel to a slab must yield +-inf, not NaN.
    vec3 safeDir = max(abs(dir), vec3(1e-6)) * (step(0.0, dir) * 2.0 - 1.0);
    vec3 tA = (-vProxyHalf - rayOrigin) / safeDir;
    vec3 tB = (vProxyHalf - rayOrigin) / safeDir;
    vec3 tSmall = min(tA, tB);
    vec3 tBig = max(tA, tB);
    float tNear = max(max(max(tSmall.x, tSmall.y), tSmall.z), 0.0);
    float tFar = min(min(tBig.x, tBig.y), tBig.z);
    if (tFar <= tNear) discard;

    float span = tFar - tNear;
    float stride = span / float(HAZE_STEPS);
    // Screen-space dither: jittered samples read as grain, aligned ones as banding.
    float jitter = hash13(vec3(gl_FragCoord.xy, 7.31));
    // Drifting upwards, like smoke rising off the object.
    vec3 drop = vec3(0.0, -uTime * uNoiseSpeed, 0.0);

    float optical = 0.0;
    float wisp = 0.0;
    float weight = 0.0;
    for (int i = 0; i < HAZE_STEPS; i += 1) {
      float t = tNear + (float(i) + jitter) * stride;
      float shape = smoothstep(uFeather, 0.0, coreDistance(rayOrigin + dir * t));
      if (shape <= 0.0) continue;
      // Noise sampled inside the march, so the mist is wispy through its depth and not a smooth
      // film painted on one surface.
      float n = valueNoise((cameraPosition + rayDir * t) * uNoiseScale + drop);
      optical += shape * mix(1.0 - uHazeDensity, 1.0 + uHazeDensity * 0.45, n);
      wisp += shape * n;
      weight += shape;
    }
    optical *= stride;
    // A ray that runs through the furniture is kept faint: a halo around the silhouette reads as an
    // aura, the same density over the object reads as fog on the lens. The chord eases in over the
    // occlusion softness, so the object's bounding box never shows up as a straight edge.
    optical *= mix(1.0, uVeil,
      smoothstep(0.0, uOcclusionSoftness, objectChord(vCenterLocal + rayOrigin / vScale, safeDir)));
    if (optical <= 0.0) discard;
    wisp = weight > 0.0 ? wisp / weight : 0.5;

    vec3 mid = cameraPosition + rayDir * (tNear + span * 0.5);
    // A second, far slower field: the wandering brightening that replaced the travelling band.
    float drift = valueNoise(mid * (uNoiseScale * 0.32)
      + vec3(uTime * uDriftSpeed * 0.6, uTime * uDriftSpeed, 0.0));
    float density = max(1.0 + uDriftGain * (drift - 0.5), 0.0);

    // A camera standing inside the mist would otherwise wash the whole viewport; let the aura give
    // way as it is entered, the way real haze stops being visible once you are in it.
    float approach = smoothstep(-uFeather, uFeather, coreDistance(rayOrigin));

    float breath = 1.0 - uBreathDepth + uBreathDepth * (0.5 + 0.5 * sin(uTime * uBreathSpeed));
    float alpha = 1.0 - exp(-optical * uAbsorption * density);
    alpha = clamp(alpha, 0.0, 1.0) * uPeakOpacity * breath * uIntensity * approach;

    float along = dot(mid - uOrigin, normalize(uSweepAxis)) / uSweepLength;
    vec3 color = iridescent(along * uHueScale + uTime * uHueSpeed + (wisp - 0.5) * 0.4);
    // The wandering brightening whitens the mist a little, without ever drawing an edge.
    color = mix(color, vec3(1.0), clamp((drift - 0.5) * uDriftGain * 1.4, 0.0, 0.28));

    // Premultiplied alpha with a boost: additive-looking where the mist is dense, so overlapping
    // envelopes accumulate instead of showing a seam.
    gl_FragColor = vec4(color * alpha * uBloom, alpha);
    #include <colorspace_fragment>
  }
`;
