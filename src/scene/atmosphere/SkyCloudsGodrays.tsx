import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { atmosphere, journey, sampleAtmosphere } from './atmosphereState'
import { cloudLobes, TIER } from './quality'

/**
 * Sky, clouds and crepuscular light — WebGL2 / GLSL ES 3.00 only.
 *
 * Three layers, all driven by the one atmosphere sample:
 *
 *  1. `SkyDome`   – the gradient the light comes from. No sun disc (house rule): the glow, the
 *                   horizon haze and a soft fan of shafts carry it. The fan is a real crepuscular
 *                   ray pattern (beams diverge from the sun by perspective), and the cumulus in
 *                   front of it cuts it into stripes — which is what makes a god-ray read.
 *  2. `CloudSea`  – the hazy layer the cumulus tops emerge from: a horizontal FBM field at the
 *                   cloud base, faded near the lens and into the horizon haze.
 *  3. `Clouds`    – `Cumulus humilis`: flat base, domed cauliflower top. Instanced lobes with a
 *                   per-instance base plane, cut with `discard` so every cloud has one hard flat
 *                   bottom, then a 2-step toon light + rim, per REFERENCES §18.
 */

const GLSL_HEAD = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`

/* ------------------------------------------------------------------ sky */

const skyVertex = /* glsl */ `
out vec3 vDir;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDir = world.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const skyFragment = /* glsl */ `
in vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uLand;
uniform vec3 uSunColor;
uniform vec3 uHaze;
uniform vec3 uSunDir;
uniform float uSunPower;
uniform float uMist;
uniform float uShaft;
uniform float uWindow;
uniform float uTime;
layout(location = 0) out vec4 fragColor;
${GLSL_HEAD}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;

  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.17, max(h, 0.0)));
  col = mix(col, uZenith, smoothstep(0.10, 0.52, max(h, 0.0)));
  // below the horizon: atmospheric perspective on the land (or the water's underside)
  col = mix(uLand, col, smoothstep(-0.22, 0.01, h));
  // the haze gathers at the horizon and thickens with the weather
  col = mix(col, uHaze, exp(-abs(h) * 11.0) * (0.28 + 0.42 * uMist));

  // the sun: glow only, never a disc
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * (pow(sd, 4.0) * 0.14 + pow(sd, 70.0) * 0.5) * uSunPower;

  // crepuscular shafts: a slowly turning fan around the sun, cut by the clouds in front of it
  vec3 t1 = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)) + vec3(0.0001));
  vec3 t2 = cross(uSunDir, t1);
  vec2 rel = vec2(dot(d, t1), dot(d, t2));
  float r = length(rel);
  float ang = atan(rel.y, rel.x);
  float fan = 0.5 + 0.5 * sin(ang * 13.0 + sin(ang * 3.1) * 1.1 + uTime * 0.035);
  fan = pow(fan, 4.0);
  float reach = smoothstep(0.02, 0.30, r) * (1.0 - smoothstep(0.6, 1.2, r)) * smoothstep(0.0, 0.5, sd);
  col += uSunColor * fan * reach * 0.16 * uShaft;

  // Snell's window: the surface seen from below — a bright, wobbling opening overhead
  float up = max(h, 0.0);
  float wob = 0.02 * sin(d.x * 15.0 + uTime * 0.7) * sin(d.z * 13.0 - uTime * 0.55);
  float win = smoothstep(0.72, 0.90, up + wob);
  col += uSunColor * win * 0.30 * uWindow;
  col += uSunColor * pow(up, 9.0) * 0.16 * uWindow;

  // a breath of grain so the big gradients never band
  col += (hash21(gl_FragCoord.xy + fract(uTime) * 41.0) - 0.5) * 0.006;
  fragColor = vec4(max(col, 0.0), 1.0);
}
`

function SkyDome() {
  const camera = useThree((state) => state.camera)
  const mesh = useRef<THREE.Mesh>(null)
  const geometry = useMemo(() => new THREE.SphereGeometry(600, 48, 28), [])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uZenith: { value: new THREE.Color() },
          uMid: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uLand: { value: new THREE.Color() },
          uSunColor: { value: new THREE.Color() },
          uHaze: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunPower: { value: 1 },
          uMist: { value: 0.5 },
          uShaft: { value: 0.5 },
          uWindow: { value: 0 },
          uTime: { value: 0 },
        },
      }),
    [],
  )

  useFrame(() => {
    sampleAtmosphere(journey.u)
    const uniforms = material.uniforms
    uniforms.uZenith.value.copy(atmosphere.zenith)
    uniforms.uMid.value.copy(atmosphere.mid)
    uniforms.uHorizon.value.copy(atmosphere.horizon)
    uniforms.uLand.value.copy(atmosphere.land)
    uniforms.uSunColor.value.copy(atmosphere.sun)
    uniforms.uHaze.value.copy(atmosphere.haze)
    uniforms.uSunDir.value.copy(atmosphere.sunDir)
    uniforms.uSunPower.value = atmosphere.sunPower
    uniforms.uMist.value = atmosphere.mist
    uniforms.uShaft.value = atmosphere.shaft
    uniforms.uWindow.value = atmosphere.window
    uniforms.uTime.value = journey.time
    mesh.current?.position.copy(camera.position)
  })

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} renderOrder={-100} />
}

/* ------------------------------------------------------------ cloud sea */

const seaVertex = /* glsl */ `
out vec2 vUv;
out vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const seaFragment = /* glsl */ `
in vec2 vUv;
in vec3 vWorld;
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uHaze;
uniform vec3 uMid;
uniform float uSea;
uniform float uTime;
layout(location = 0) out vec4 fragColor;
${GLSL_HEAD}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.62;
  for (int i = 0; i < 2; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + 19.0;
    a *= 0.38;
  }
  return v;
}
void main() {
  if (uSea < 0.01) discard;
  // a deck of cumulus tops: big soft cells, lit from above, thinner toward the horizon
  vec2 drift = vec2(uTime * 0.006, uTime * 0.004);
  vec2 q = vUv * 55.0 + drift;
  float n = fbm(q);
  float n2 = fbm(q * 1.7 + 5.0);
  float field = n * 0.80 + n2 * 0.26;

  float d = length(vWorld.xz - cameraPosition.xz);
  float near = smoothstep(4.0, 42.0, d);
  float far = 1.0 - smoothstep(240.0, 520.0, d);
  float cover = smoothstep(0.26, 0.66, field);
  float alpha = uSea * near * far * (0.55 + 0.45 * cover);
  if (alpha < 0.004) discard;

  vec3 col = mix(uLit * 0.86, uLit, 0.34 + 0.66 * smoothstep(0.20, 0.78, field));
  col = mix(col, uMid, 0.12);
  col = mix(col, uLit * 1.03, pow(n2, 2.0) * 0.30);
  col = mix(col, uHaze, smoothstep(160.0, 500.0, d) * 0.9);
  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.006;
  fragColor = vec4(col, alpha);
}
`

function CloudSea() {
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(1400, 1400, 1, 1)
    plane.rotateX(-Math.PI / 2)
    return plane
  }, [])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: seaVertex,
        fragmentShader: seaFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
        uniforms: {
          uLit: { value: new THREE.Color() },
          uShade: { value: new THREE.Color() },
          uHaze: { value: new THREE.Color() },
          uMid: { value: new THREE.Color() },
          uSea: { value: 1 },
          uTime: { value: 0 },
        },
      }),
    [],
  )
  useFrame(() => {
    sampleAtmosphere(journey.u)
    const u = material.uniforms
    u.uLit.value.copy(atmosphere.cloudLit)
    u.uShade.value.copy(atmosphere.cloudShade)
    u.uHaze.value.copy(atmosphere.haze)
    u.uMid.value.copy(atmosphere.mid)
    u.uSea.value = atmosphere.sea
    u.uTime.value = journey.time
  })
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[0, 46, -40]}
      frustumCulled={false}
      renderOrder={-50}
    />
  )
}

/* -------------------------------------------------------------- cumulus */

type Lobe = { x: number; y: number; z: number; sx: number; sy: number; base: number; tint: number; drift: number }

function buildLobes(count: number): Lobe[] {
  const lobes: Lobe[] = []
  const rand = mulberry(20261124)
  const clouds = Math.max(8, Math.round(count / 9))
  for (let c = 0; c < clouds; c++) {
    const low = c < 3 // a loose band the lens drops through between beats 1 and 2
    const near = !low && c < 7
    const radius = low ? 5 + rand() * 5 : near ? 7 + rand() * 7 : 11 + rand() * 15
    const cx = (rand() * 2 - 1) * (low ? 60 : near ? 80 : 230)
    const cz = low ? -55 - rand() * 70 : near ? -80 - rand() * 70 : -110 - rand() * 220
    const cy = low ? 17 + rand() * 14 : 48 + rand() * (near ? 14 : 30)
    const base = low ? cy - radius * 0.45 : 46.5
    const n = 7 + Math.floor(rand() * 5)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.8
      const rad = radius * (0.15 + rand() * 0.82)
      const size = radius * (0.26 + Math.pow(rand(), 1.6) * 0.62)
      lobes.push({
        x: cx + Math.cos(a) * rad,
        y: base + size * 0.55 + rand() * radius * 0.42,
        z: cz + Math.sin(a) * rad * 0.85,
        sx: size,
        sy: size * (0.58 + rand() * 0.2),
        base,
        tint: rand(),
        drift: 0.6 + rand() * 0.8,
      })
    }
  }
  return lobes.slice(0, count)
}

/** deterministic PRNG so every reload paints the same sky */
function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const cloudVertex = /* glsl */ `
in float aTint;
in float aDrift;
in float aBase;
uniform float uTime;
uniform float uLift;
out vec3 vWorld;
out vec3 vNormalW;
out float vTint;
out float vBase;
out float vDist;
void main() {
  mat4 m = instanceMatrix;
  vec4 local = m * vec4(position, 1.0);
  vec3 world = local.xyz;
  world.x += uTime * 0.5 * aDrift;
  world.y += uLift;
  vWorld = world;
  vNormalW = normalize(mat3(m) * normal);
  vTint = aTint;
  vBase = aBase + uLift;
  vec4 view = viewMatrix * vec4(world, 1.0);
  vDist = -view.z;
  gl_Position = projectionMatrix * view;
}
`

const cloudFragment = /* glsl */ `
in vec3 vWorld;
in vec3 vNormalW;
in float vTint;
in float vBase;
in float vDist;
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uRim;
uniform vec3 uHaze;
uniform vec3 uSunDir;
uniform float uSunPower;
layout(location = 0) out vec4 fragColor;
${GLSL_HEAD}
void main() {
  // the flat base of cumulus humilis: one hard, level bottom per cloud
  if (vWorld.y < vBase + hash21(floor(vWorld.xz * 3.0)) * 0.12) discard;

  vec3 n = normalize(vNormalW);
  vec3 v = normalize(cameraPosition - vWorld);
  float l = dot(n, uSunDir);
  float form = smoothstep(-0.10, 0.12, l);
  float sun = smoothstep(0.36, 0.62, l);

  // a vertical ramp holds the lobes together as one mass; the sun only shapes the local form
  float up = clamp((vWorld.y - vBase) / 26.0, 0.0, 1.0);
  float ramp = 0.46 + 0.54 * pow(up, 0.6);
  float lightAmt = clamp(ramp * 0.66 + form * 0.34, 0.0, 1.0);
  vec3 col = mix(uShade, uLit, lightAmt);
  col = mix(col, uShade * 1.02, (1.0 - form) * (0.16 + 0.2 * vTint));
  col = mix(col, uShade * 0.92, pow(1.0 - form, 2.0) * 0.28);
  col *= 0.90 + 0.12 * clamp(n.y, -1.0, 1.0);

  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += uRim * rim * (0.35 + 0.65 * sun) * 0.55;

  // the underside darkens toward the flat base, then dissolves into the haze the cloud sits in
  float above = smoothstep(0.0, 6.0, vWorld.y - vBase);
  col = mix(uShade * 0.78, col, 0.28 + 0.72 * above);
  col = mix(col, uHaze, (1.0 - smoothstep(0.0, 5.5, vWorld.y - vBase)) * 0.7);

  // aerial perspective: far clouds lean into the horizon haze
  float haze = clamp(vDist / 300.0, 0.0, 1.0);
  col = mix(col, uHaze, haze * haze * 0.7);
  col *= 0.94 + 0.12 * uSunPower;

  fragColor = vec4(col, 1.0);
}
`

function Clouds() {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => new THREE.SphereGeometry(1, TIER === 'low' ? 9 : 12, TIER === 'low' ? 7 : 9), [])
  const lobes = useMemo(() => buildLobes(cloudLobes), [])
  const attributes = useMemo(() => {
    const tint = new Float32Array(lobes.length)
    const drift = new Float32Array(lobes.length)
    const base = new Float32Array(lobes.length)
    lobes.forEach((lobe, i) => {
      tint[i] = lobe.tint
      drift[i] = lobe.drift
      base[i] = lobe.base
    })
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1))
    geometry.setAttribute('aDrift', new THREE.InstancedBufferAttribute(drift, 1))
    geometry.setAttribute('aBase', new THREE.InstancedBufferAttribute(base, 1))
    return geometry
  }, [lobes, geometry])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: cloudVertex,
        fragmentShader: cloudFragment,
        uniforms: {
          uLit: { value: new THREE.Color() },
          uShade: { value: new THREE.Color() },
          uRim: { value: new THREE.Color() },
          uHaze: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunPower: { value: 1 },
          uTime: { value: 0 },
          uLift: { value: 0 },
        },
      }),
    [],
  )

  const placed = useRef(false)
  useFrame(() => {
    sampleAtmosphere(journey.u)
    const uniforms = material.uniforms
    uniforms.uLit.value.copy(atmosphere.cloudLit)
    uniforms.uShade.value.copy(atmosphere.cloudShade)
    uniforms.uRim.value.copy(atmosphere.cloudRim)
    uniforms.uHaze.value.copy(atmosphere.haze)
    uniforms.uSunDir.value.copy(atmosphere.sunDir)
    uniforms.uSunPower.value = atmosphere.sunPower
    uniforms.uTime.value = journey.time
    // the dive: the cloud deck rises out of the frame instead of fading through its own lobes
    const dive = Math.max(0, Math.min(1, (journey.u - 3.5) / 0.5))
    uniforms.uLift.value = dive * dive * 420
    if (mesh.current) mesh.current.visible = atmosphere.sea > 0.02 || journey.u < 3.6

    if (mesh.current && !placed.current) {
      placed.current = true
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      const s = new THREE.Vector3()
      const p = new THREE.Vector3()
      const up = new THREE.Vector3(0, 1, 0)
      lobes.forEach((lobe, i) => {
        p.set(lobe.x, lobe.y, lobe.z)
        q.setFromAxisAngle(up, lobe.tint * Math.PI * 2)
        s.set(lobe.sx, lobe.sy, lobe.sx)
        m.compose(p, q, s)
        mesh.current!.setMatrixAt(i, m)
      })
      mesh.current.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <instancedMesh
      ref={mesh}
      args={[attributes, material, lobes.length]}
      frustumCulled={false}
      renderOrder={-40}
    />
  )
}

export function SkyCloudsGodrays() {
  return (
    <>
      <SkyDome />
      <CloudSea />
      <Clouds />
    </>
  )
}
