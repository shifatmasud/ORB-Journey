import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

/**
 * The protagonist: one emissive amethyst core, no shell around it.
 *
 * Shading is a light source with structure, not a lit ball — a dense violet
 * body, slow internal density, a forward-scattering limb (subsurface) and a
 * thin refractive rim. Normals come from the sphere itself, so there is no
 * faceting and nothing is drawn outside the core's silhouette (no halo).
 *
 * GLSL ES 3.00 (`THREE.GLSL3`) — WebGL2 only, see `src/gl/webgl2.ts`.
 */

export type OrbNumberRef = { readonly current: number }
export type OrbPointer = { readonly x: number; readonly y: number }
export type OrbPointerRef = { readonly current: OrbPointer | null }

type PurpleOrbProps = {
  /** Scroll progress 0..1, read once per frame. */
  progressRef: OrbNumberRef
  /** Pointer in -1..1 screen units (null when untouched). */
  pointerRef: OrbPointerRef
}

const ORB_RADIUS = 0.62
const MAX_DELTA = 1 / 20

const vertexShader = /* glsl */ `
out vec3 vNormalView;
out vec3 vLocalPos;
out vec3 vViewDir;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vNormalView = normalize(normalMatrix * normal);
  vLocalPos = normalize(position);
  vViewDir = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}
`

const fragmentShader = /* glsl */ `
in vec3 vNormalView;
in vec3 vLocalPos;
in vec3 vViewDir;

uniform float uTime;
uniform float uProgress;
uniform vec2 uPointer;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uCore;
uniform vec3 uRim;

layout(location = 0) out vec4 fragColor;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
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
    f.z
  );
}

void main() {
  vec3 N = normalize(vNormalView);
  vec3 V = normalize(vViewDir);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float limb = 1.0 - ndv;

  // 1 — body: a glowing amethyst volume, deepest just inside the limb
  vec3 color = mix(uDeep, uMid, smoothstep(0.12, 0.95, ndv));
  float core = pow(ndv, 2.2);

  // 2 — internal density: slow currents inside the core, no surface pattern
  vec3 flow = vLocalPos * 5.2 + vec3(0.0, -uTime * 0.045, uTime * 0.032);
  float density = 0.58 * valueNoise(flow) + 0.42 * valueNoise(flow * 2.3 + 7.3);
  color *= 0.76 + 0.42 * density;
  color += uCore * core * (0.34 + 0.58 * density);

  // 3 — one soft key from the upper left, so the sphere has form
  float key = 0.5 + 0.5 * dot(vLocalPos, normalize(vec3(-0.55, 0.62, 0.56)));
  color *= 0.91 + 0.15 * key;

  // 4 — subsurface: light entering the thin limb and scattering forward,
  //     strongest on the side the pointer sits on
  vec3 toPointer = normalize(vec3(uPointer * 0.9, 0.55));
  float lit = 0.5 + 0.5 * dot(vLocalPos, toPointer);
  color += mix(uMid, uRim, 0.55) * pow(limb, 2.6) * (0.55 + 0.32 * lit);

  // 5 — thin refractive rim (the only "edge" the orb has)
  color += uRim * pow(limb, 10.0) * (1.45 + 0.45 * lit);

  // 6 — one slow breath, and a little more presence as the journey deepens
  float breath = 1.0 + 0.03 * sin(uTime * 0.55);
  color *= breath * (0.95 + 0.10 * uProgress);

  fragColor = vec4(color, 1.0);
}
`

export function PurpleOrb({ progressRef, pointerRef }: PurpleOrbProps) {
  const timeRef = useRef(0)
  const pointer = useMemo(() => new THREE.Vector2(0, 0), [])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader,
        fragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uProgress: { value: 0 },
          uPointer: { value: pointer },
          uDeep: { value: new THREE.Color('#3a1a76') },
          uMid: { value: new THREE.Color('#7a3fd8') },
          uCore: { value: new THREE.Color('#a05cff') },
          uRim: { value: new THREE.Color('#e2ccff') },
        },
        transparent: false,
        depthWrite: true,
        depthTest: true,
        side: THREE.FrontSide,
        toneMapped: false,
      }),
    [pointer],
  )

  useEffect(() => () => material.dispose(), [material])

  useFrame((_, delta) => {
    timeRef.current += Math.min(delta, MAX_DELTA)
    const uniforms = material.uniforms
    uniforms.uTime.value = timeRef.current
    uniforms.uProgress.value = THREE.MathUtils.clamp(progressRef.current, 0, 1)

    const p = pointerRef.current
    pointer.set(p ? p.x : 0, p ? p.y : 0)
  })

  return (
    <mesh frustumCulled={false} material={material} renderOrder={0}>
      <sphereGeometry args={[ORB_RADIUS, 72, 48]} />
    </mesh>
  )
}
