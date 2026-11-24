import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import type { OrbNumberRef, OrbPointerRef } from './PurpleOrb'

/**
 * Three tilted electron-like orbital rings of tiny particles.
 *
 * The motion is a real GPU simulation: a WebGL2 ping-pong pair of
 * `HalfFloatType` render targets, stepped once per frame. Each texel holds one
 * particle — `xyz` = its current position, `w` = its twinkle phase. A static
 * `RGBA32F` table holds each particle's ring tilt (`xy`), ring index (`z`) and
 * orbit radius (`w`), so the rings can precess without any CPU work.
 *
 * Particle count is the only thing the tier moves (48×48 on phones, 96×96 on
 * desktop): 1 draw call for the rings either way.
 */

type GpgpuRingsProps = {
  progressRef: OrbNumberRef
  pointerRef: OrbPointerRef
  tier: 'low' | 'high'
}

const RINGS = [
  { tiltX: 1.28, tiltZ: 0.10, radius: 0.84 },
  { tiltX: 0.55, tiltZ: 0.75, radius: 1.06 },
  { tiltX: 1.02, tiltZ: -0.35, radius: 1.34 },
] as const

const MAX_DELTA = 1 / 20
/** Base orbital rate (rad/s at r = 1). Inner rings sweep faster, v ∝ r^-1.5. */
const SPIN = 1.05

/** Ring plane normal from two tilts; shared by the simulation and the fallback. */
const ORBIT_NORMAL_GLSL = /* glsl */ `
vec3 orbitNormal(vec2 tilt, float ringIndex) {
  float a = tilt.x + 0.10 * sin(uTime * 0.061 + ringIndex * 2.4);
  float b = tilt.y + 0.10 * cos(uTime * 0.048 + ringIndex * 1.9);
  float ca = cos(a);
  float sa = sin(a);
  float cb = cos(b);
  float sb = sin(b);
  return vec3(-ca * sb, ca * cb, sa);
}
`

const HASH_GLSL = /* glsl */ `
// Hash without sine (Dave Hoskins) on *integer texel* coordinates: a cheap
// fract-product hash on the texel grid moirés into diagonal bands, which
// clumps the particles into waves instead of a ring.
float hash21(vec2 texel) {
  vec3 p = fract(vec3(texel.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
`

const TEXEL_GLSL = /* glsl */ `
uniform float uTexSize;

vec2 texelOf(vec2 uv) {
  return floor(uv * uTexSize);
}
`

const SIM_VERTEX = /* glsl */ `
out vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const SIM_FRAGMENT = /* glsl */ `
in vec2 vUv;

uniform sampler2D uPrev;
uniform sampler2D uOrbit;
uniform float uDt;
uniform float uTime;
uniform float uSpin;
uniform float uScroll;
uniform float uPush;
uniform vec3 uPointer;

layout(location = 0) out vec4 fragColor;
${HASH_GLSL}
${TEXEL_GLSL}
${ORBIT_NORMAL_GLSL}

void main() {
  vec4 state = texture(uPrev, vUv);
  vec4 orbit = texture(uOrbit, vUv);
  vec3 n = orbitNormal(orbit.xy, orbit.z);
  float radius = orbit.w;
  float seed = hash21(texelOf(vUv));

  vec3 pos = state.xyz;
  float phase = state.w;

  // Kepler-ish sweep: the inner ring is visibly quicker than the outer one,
  // and a fast scroll adds a little urgency.
  float w = uSpin * pow(1.0 / radius, 1.5) * (0.82 + 0.36 * seed) * (1.0 + 0.55 * abs(uScroll));

  // Tangent of the orbit inside its own plane, then step along the arc.
  vec3 radial = pos - n * dot(pos, n);
  float len = length(radial);
  radial = len > 1e-4 ? radial / len : normalize(cross(n, vec3(0.0, 1.0, 0.0)));
  radial = normalize(radial + cross(n, radial) * (w * uDt));

  // Rebuild the position from the orbit every step instead of integrating it:
  // the ring planes precess, and an integrated position would let that tilt
  // smear each ring into a braided band.
  float target = radius * (1.0 + 0.03 * uScroll);
  float thickness = (seed - 0.5) * 0.010 +
    0.0025 * sin(uTime * 0.6 + dot(radial, vec3(3.1, 2.3, 1.7)) * 2.0);
  pos = radial * target + n * thickness;

  // Pointer proximity: a soft, short-range push, applied fresh each frame so
  // it nudges the ring without ever scattering the orbit.
  vec3 away = pos - uPointer;
  float d2 = dot(away, away);
  pos += (away / max(sqrt(d2), 1e-3)) * 0.045 * uPush * exp(-d2 * 3.0);

  phase += uDt * (0.4 + 0.6 * seed) * (1.0 + 0.4 * abs(uScroll));

  fragColor = vec4(pos, fract(phase));
}
`

const INIT_FRAGMENT = /* glsl */ `
in vec2 vUv;

uniform sampler2D uOrbit;
uniform float uTime;

layout(location = 0) out vec4 fragColor;
${HASH_GLSL}
${TEXEL_GLSL}
${ORBIT_NORMAL_GLSL}

void main() {
  vec4 orbit = texture(uOrbit, vUv);
  vec3 n = orbitNormal(orbit.xy, orbit.z);
  float radius = orbit.w;
  float seed = hash21(texelOf(vUv) + 17.0);

  vec3 e1 = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(n, e1);

  float theta = hash21(texelOf(vUv) + 53.0) * 6.2831853;
  float r = radius * (1.0 + (hash21(texelOf(vUv) + 91.0) - 0.5) * 0.012);
  vec3 pos = (e1 * cos(theta) + e2 * sin(theta)) * r + n * (hash21(texelOf(vUv) + 7.0) - 0.5) * 0.006;

  fragColor = vec4(pos, seed);
}
`

const POINTS_VERTEX = /* glsl */ `
in vec2 aRef;

uniform sampler2D uPos;
uniform sampler2D uOrbit;
uniform float uTime;
uniform float uSpin;
uniform float uPointScale;
uniform float uFallback;

out vec3 vTint;
out float vBright;

${HASH_GLSL}
${TEXEL_GLSL}
${ORBIT_NORMAL_GLSL}

void main() {
  // Vertex shaders have no implicit LOD in GLSL ES 3.00.
  vec4 state = textureLod(uPos, aRef, 0.0);
  vec4 orbit = textureLod(uOrbit, aRef, 0.0);
  float seed = hash21(texelOf(aRef));

  vec3 pos = state.xyz;
  if (uFallback > 0.5) {
    vec3 n = orbitNormal(orbit.xy, orbit.z);
    vec3 e1 = normalize(abs(n.y) < 0.9 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(n, e1);
    float theta = seed * 6.2831853 + uTime * uSpin * pow(1.0 / orbit.w, 1.5) * 0.8;
    pos = (e1 * cos(theta) + e2 * sin(theta)) * orbit.w;
  }

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float dist = max(-mvPosition.z, 0.25);
  float size = uPointScale * (0.85 + 0.35 * seed);
  gl_PointSize = clamp(size / dist, 1.2, 2.2);

  float ringT = clamp(orbit.z * 0.5, 0.0, 1.0);
  vTint = mix(vec3(0.86, 0.80, 1.0), vec3(0.56, 0.40, 0.98), ringT);

  float twinkle = 0.82 + 0.18 * sin(uTime * (0.55 + 0.9 * seed) + seed * 41.0);
  vBright = twinkle * (1.0 - 0.20 * ringT) * (0.85 + 0.15 * seed);
}
`

const POINTS_FRAGMENT = /* glsl */ `
in vec3 vTint;
in float vBright;

uniform float uOpacity;

layout(location = 0) out vec4 fragColor;

void main() {
  vec2 offset = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(offset, offset);
  if (d2 > 1.0) discard;

  float falloff = pow(smoothstep(1.0, 0.1, d2), 1.5);
  float alpha = falloff * vBright * uOpacity;
  fragColor = vec4(vTint * alpha, alpha);
}
`

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type RingSystem = {
  points: THREE.Points
  supported: boolean
  step: (
    renderer: THREE.WebGLRenderer,
    dt: number,
    time: number,
    pointer: THREE.Vector3 | null,
    scroll: number,
  ) => void
  dispose: () => void
}

function createRingSystem(renderer: THREE.WebGLRenderer, size: number): RingSystem {
  const count = size * size
  const random = mulberry32(0x0b1)

  // Static per-particle orbit table: tilt (xy), ring index (z), radius (w).
  const orbitData = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const ring = RINGS[i % RINGS.length]
    const slope = (random() - 0.5) * 0.035
    orbitData[i * 4 + 0] = ring.tiltX + slope
    orbitData[i * 4 + 1] = ring.tiltZ - slope
    orbitData[i * 4 + 2] = i % RINGS.length
    orbitData[i * 4 + 3] = ring.radius * (0.992 + random() * 0.016)
  }
  const orbitTexture = new THREE.DataTexture(orbitData, size, size, THREE.RGBAFormat, THREE.FloatType)
  orbitTexture.minFilter = THREE.NearestFilter
  orbitTexture.magFilter = THREE.NearestFilter
  orbitTexture.wrapS = THREE.ClampToEdgeWrapping
  orbitTexture.wrapT = THREE.ClampToEdgeWrapping
  orbitTexture.needsUpdate = true

  const supported =
    renderer.extensions.has('EXT_color_buffer_half_float') ||
    renderer.extensions.has('EXT_color_buffer_float')

  const makeTarget = () =>
    new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    })

  const targets = supported ? [makeTarget(), makeTarget()] : []

  // A 1×1 placeholder keeps the `uPos` sampler bound on the fallback path.
  const placeholder = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType)
  placeholder.needsUpdate = true

  const uniforms = {
    uDt: { value: 0 },
    uTime: { value: 0 },
    uSpin: { value: SPIN },
    uScroll: { value: 0 },
    uPush: { value: 0 },
    uPointer: { value: new THREE.Vector3(0, 0, 0) },
  }

  const simMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: SIM_VERTEX,
    fragmentShader: SIM_FRAGMENT,
    uniforms: {
      ...uniforms,
      uPrev: { value: placeholder },
      uOrbit: { value: orbitTexture },
      uTexSize: { value: size },
    },
    depthTest: false,
    depthWrite: false,
  })

  const initMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: SIM_VERTEX,
    fragmentShader: INIT_FRAGMENT,
    uniforms: {
      uOrbit: { value: orbitTexture },
      uTexSize: { value: size },
      uTime: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  })

  const quadScene = new THREE.Scene()
  const quadCamera = new THREE.Camera()
  const quadGeometry = new THREE.PlaneGeometry(2, 2)
  const quad = new THREE.Mesh(quadGeometry, initMaterial)
  quad.frustumCulled = false
  quadScene.add(quad)

  // Particles: one point per texel, addressed by `aRef`.
  const positions = new Float32Array(count * 3)
  const refs = new Float32Array(count * 2)
  for (let i = 0; i < count; i++) {
    const x = i % size
    const y = (i / size) | 0
    refs[i * 2 + 0] = (x + 0.5) / size
    refs[i * 2 + 1] = (y + 0.5) / size
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aRef', new THREE.BufferAttribute(refs, 2))

  const pointsMaterial = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: POINTS_VERTEX,
    fragmentShader: POINTS_FRAGMENT,
    uniforms: {
      uPos: { value: targets[0]?.texture ?? placeholder },
      uOrbit: { value: orbitTexture },
      uTime: uniforms.uTime,
      uSpin: uniforms.uSpin,
      uPointScale: { value: 0 },
      uOpacity: { value: 1.1 },
      uTexSize: { value: size },
      uFallback: { value: supported ? 0 : 1 },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })

  const points = new THREE.Points(geometry, pointsMaterial)
  points.frustumCulled = false
  points.renderOrder = 2

  let read = 0
  let write = 1
  let booted = false

  const step: RingSystem['step'] = (gl, dt, time, pointer, scroll) => {
    uniforms.uTime.value = time
    uniforms.uScroll.value = scroll
    uniforms.uPush.value = pointer ? 1 : 0
    if (pointer) uniforms.uPointer.value.copy(pointer)
    // Framebuffer pixels covered by one world unit at one unit of depth.
    pointsMaterial.uniforms.uPointScale.value = gl.domElement.height * 0.010

    if (!supported || targets.length < 2) return

    const previous = gl.getRenderTarget()

    if (!booted) {
      quad.material = initMaterial
      initMaterial.uniforms.uTime.value = 0
      gl.setRenderTarget(targets[0])
      gl.render(quadScene, quadCamera)
      gl.setRenderTarget(targets[1])
      gl.render(quadScene, quadCamera)
      booted = true
    }

    uniforms.uDt.value = dt
    simMaterial.uniforms.uPrev.value = targets[read].texture
    quad.material = simMaterial
    gl.setRenderTarget(targets[write])
    gl.render(quadScene, quadCamera)
    gl.setRenderTarget(previous)

    pointsMaterial.uniforms.uPos.value = targets[write].texture
    const swap = read
    read = write
    write = swap
  }

  const dispose = () => {
    for (const target of targets) target.dispose()
    orbitTexture.dispose()
    placeholder.dispose()
    geometry.dispose()
    simMaterial.dispose()
    initMaterial.dispose()
    pointsMaterial.dispose()
    quadGeometry.dispose()
  }

  return { points, supported, step, dispose }
}

export function GpgpuRings({ progressRef, pointerRef, tier }: GpgpuRingsProps) {
  const gl = useThree((state) => state.gl)

  const size = tier === 'low' ? 80 : 96
  const [system, setSystem] = useState<RingSystem | null>(null)
  const timeRef = useMemo(() => ({ t: 0 }), [])
  const motion = useMemo(
    () => ({
      progress: 0,
      scroll: 0,
      pointer: new THREE.Vector3(),
      has: false,
      scratch: new THREE.Vector3(),
      origin: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      inverse: new THREE.Matrix4(),
    }),
    [],
  )

  // Built inside the effect so a StrictMode remount (dev) gets a live system
  // instead of the one the simulated unmount already disposed.
  useEffect(() => {
    const created = createRingSystem(gl, size)
    setSystem(created)
    return () => {
      setSystem(null)
      created.dispose()
    }
  }, [gl, size])

  useFrame((state, delta) => {
    if (!system) return
    const dt = Math.min(delta, MAX_DELTA)
    timeRef.t += dt

    const progress = THREE.MathUtils.clamp(progressRef.current, 0, 1)
    const rawScroll = dt > 0 ? (progress - motion.progress) / dt : 0
    motion.progress = progress
    // Smoothed, so a single scroll tick cannot kick the rings.
    motion.scroll += (THREE.MathUtils.clamp(rawScroll * 0.35, -1, 1) - motion.scroll) * Math.min(1, dt * 8)

    const input = pointerRef.current
    motion.has = input !== null
    if (input) {
      // Pointer proximity is measured in the rings' own space, so it survives
      // any group transform the stage puts around the orb.
      const camera = state.camera
      motion.scratch.set(input.x, input.y, 0.5).unproject(camera).sub(camera.position).normalize()
      motion.origin.setFromMatrixPosition(system.points.matrixWorld)
      camera.getWorldDirection(motion.forward)
      const denom = motion.scratch.dot(motion.forward)
      const distance = Math.abs(denom) < 1e-4
        ? camera.position.distanceTo(motion.origin)
        : motion.origin.sub(camera.position).dot(motion.forward) / denom
      motion.pointer
        .copy(motion.scratch)
        .multiplyScalar(Math.max(distance, 0.1))
        .add(camera.position)
        .applyMatrix4(motion.inverse.copy(system.points.matrixWorld).invert())
    }

    system.step(gl, dt, timeRef.t, motion.has ? motion.pointer : null, motion.scroll)
  })

  return system ? <primitive object={system.points} /> : null
}
