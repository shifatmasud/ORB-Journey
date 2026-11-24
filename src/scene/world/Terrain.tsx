/**
 * The landform: a meadow shelf that runs to a wooded pool, with the forest
 * climbing the far bank and the valley walls.
 *
 * This is laid against the app's world column (Stream 4's `CameraRig` and the
 * lake pass): **ground y = 0, water line y = -1.6, cloud base y = 46**. The
 * lens descends from the clouds, crosses the meadow's edge at the pool, and
 * dives under the surface, so the pool sits directly in front of the walk at
 * z ≈ +11 … −26 and the meadow and forest fill everything around it.
 *
 * Two things here matter more than the shading:
 *  1. `heightAt()` is the only description of the ground. The render mesh is its
 *     sampled grid, and `sampleTerrain()` reads the *same* grid back through the
 *     same triangulation, so every root, stem and trunk is planted on the exact
 *     surface the GPU draws — no floating, no sinking, no z-fighting.
 *  2. `LAKE_LEVEL` is exported. `WaterBeat` must be mounted with
 *     `lake={{ level: LAKE_LEVEL, center: [0, 0] }}` so surface and shore agree.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { GLSL_LIGHT, PALETTE, color, type WorldUniforms } from './shared'

/** Water surface height — the column's -1.6 m line. */
export const LAKE_LEVEL = -1.6

export const TERRAIN_BOUNDS = { minX: -92, maxX: 92, minZ: -132, maxZ: 84 } as const
const STEP = 2.0

const X0 = TERRAIN_BOUNDS.minX
const Z0 = TERRAIN_BOUNDS.minZ
const NX = Math.round((TERRAIN_BOUNDS.maxX - X0) / STEP)
const NZ = Math.round((TERRAIN_BOUNDS.maxZ - Z0) / STEP)

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/**
 * The landform in metres. `+z` is behind the lens (the meadow), `-z` runs
 * forward through the pool to the far bank and the forest.
 */
export function heightAt(x: number, z: number): number {
  // meadow behind the lens, rising away from the water
  const nearMeadow = 0.15 + 1.05 * smoothstep(14, 56, z)
  // the far bank climbs out of the pool and keeps going to the ridge
  const farRise = 5.4 * smoothstep(26, 40, -z) + 10 * smoothstep(46, 96, -z)
  const landY = nearMeadow + farRise

  // the pool: a lens-shaped basin from z = +12 to z = -26
  const halfW = 8 + 11 * (1 - smoothstep(-26, 12, z)) + 2.4 * Math.sin(z * 0.24 + 0.7) + 1.3 * Math.sin(z * 0.63 + 2.1)
  const lateral = 1 - smoothstep(halfW, halfW + 11, Math.abs(x))
  const shoreWobble = 0.9 * Math.sin(x * 0.19 + 1.1) + 0.5 * Math.sin(x * 0.47 + 0.3)
  const nearEdge = 1 - smoothstep(9.2 + shoreWobble, 14.8 + shoreWobble * 1.6, z)
  const farEdge = smoothstep(-30 + shoreWobble, -23 + shoreWobble * 1.4, z)
  const pool = nearEdge * farEdge * lateral
  const bed = LAKE_LEVEL - 6.4 * smoothstep(0.1, 0.8, pool)
  let y = landY * (1 - pool) + bed * pool

  // valley walls (low enough that the pool still opens to the trees)
  y += 0.0022 * x * x
  const side = smoothstep(34, 92, Math.abs(x))
  y += side * side * 13

  // rolls, on dry ground only
  const dry = smoothstep(-0.3, 1.4, y)
  y +=
    dry *
    (0.5 * Math.sin(z * 0.075 + 0.8) * Math.sin(x * 0.052 + 1.7) +
      0.22 * Math.sin(x * 0.16 + z * 0.11 + 2.1) +
      0.09 * Math.sin(x * 0.38 - z * 0.29 + 0.4))
  return y
}

/* ------------------------- baked grid + exact sampler ------------------------ */

type Grid = { h: Float32Array; nx: number; nz: number }

let grid: Grid | null = null

function ensureGrid(): Grid {
  if (grid) return grid
  const h = new Float32Array((NX + 1) * (NZ + 1))
  for (let j = 0; j <= NZ; j++) {
    const z = Z0 + j * STEP
    for (let i = 0; i <= NX; i++) {
      h[j * (NX + 1) + i] = heightAt(X0 + i * STEP, z)
    }
  }
  grid = { h, nx: NX, nz: NZ }
  return grid
}

/** The drawn surface, sampled through the mesh's own triangulation. */
export function sampleTerrain(x: number, z: number): number {
  const g = ensureGrid()
  const fx = (x - X0) / STEP
  const fz = (z - Z0) / STEP
  const i = Math.min(g.nx - 1, Math.max(0, Math.floor(fx)))
  const j = Math.min(g.nz - 1, Math.max(0, Math.floor(fz)))
  const u = clamp01(fx - i)
  const v = clamp01(fz - j)
  const row = g.nx + 1
  const ha = g.h[j * row + i]
  const hb = g.h[j * row + i + 1]
  const hc = g.h[(j + 1) * row + i + 1]
  const hd = g.h[(j + 1) * row + i]
  // the mesh splits each cell on the a–c diagonal
  return v <= u ? ha + (hb - ha) * u + (hc - hb) * v : ha + (hc - hd) * u + (hd - ha) * v
}

export function terrainNormal(x: number, z: number, eps = STEP): THREE.Vector3 {
  const n = new THREE.Vector3(
    sampleTerrain(x - eps, z) - sampleTerrain(x + eps, z),
    2 * eps,
    sampleTerrain(x, z - eps) - sampleTerrain(x, z + eps),
  )
  return n.normalize()
}

/** 0 = flat, 1 = a cliff. Used to keep plants off the valley's steep faces. */
export function slopeAt(x: number, z: number): number {
  return 1 - terrainNormal(x, z).y
}

export function isUnderWater(x: number, z: number, margin = 0): boolean {
  return sampleTerrain(x, z) < LAKE_LEVEL + margin
}

/** How far above the water line a spot is (negative = submerged). */
export function waterDepthAt(x: number, z: number): number {
  return LAKE_LEVEL - sampleTerrain(x, z)
}

/* ------------------------------- geometry -------------------------------- */

function buildTerrainGeometry(): THREE.BufferGeometry {
  const g = ensureGrid()
  const row = g.nx + 1
  const positions = new Float32Array((g.nx + 1) * (g.nz + 1) * 3)
  const normals = new Float32Array((g.nx + 1) * (g.nz + 1) * 3)
  const uvs = new Float32Array((g.nx + 1) * (g.nz + 1) * 2)

  for (let j = 0; j <= g.nz; j++) {
    for (let i = 0; i <= g.nx; i++) {
      const k = j * row + i
      const x = X0 + i * STEP
      const z = Z0 + j * STEP
      positions[k * 3] = x
      positions[k * 3 + 1] = g.h[k]
      positions[k * 3 + 2] = z
      const hl = g.h[j * row + Math.max(0, i - 1)]
      const hr = g.h[j * row + Math.min(g.nx, i + 1)]
      const hd = g.h[Math.max(0, j - 1) * row + i]
      const hu = g.h[Math.min(g.nz, j + 1) * row + i]
      const n = new THREE.Vector3(hl - hr, 2 * STEP, hd - hu).normalize()
      normals[k * 3] = n.x
      normals[k * 3 + 1] = n.y
      normals[k * 3 + 2] = n.z
      uvs[k * 2] = x
      uvs[k * 2 + 1] = z
    }
  }

  const index: number[] = []
  for (let j = 0; j < g.nz; j++) {
    for (let i = 0; i < g.nx; i++) {
      const a = j * row + i
      const b = a + 1
      const c = a + row + 1
      const d = a + row
      // counter-clockwise seen from above, so the face normal points +Y
      index.push(a, c, b, a, d, c)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setIndex(index)
  geo.computeBoundingSphere()
  return geo
}

/* ------------------------------- material -------------------------------- */

function createTerrainMaterial(uniforms: WorldUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...uniforms,
      uMeadowLit: { value: color(PALETTE.grassLit) },
      uMeadowMid: { value: color(PALETTE.meadowMid) },
      uMeadowShade: { value: color(PALETTE.grassShade) },
      uLitterLit: { value: color(PALETTE.litterLit) },
      uLitterMid: { value: color(PALETTE.litterMid) },
      uLitterShade: { value: color(PALETTE.litterShade) },
      uSand: { value: color(PALETTE.sand) },
      uBedShallow: { value: color(PALETTE.bedShallow) },
      uBedDeep: { value: color(PALETTE.bedDeep) },
      uLakeLevel: { value: LAKE_LEVEL },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;

      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_LIGHT}
      uniform vec3 uMeadowLit;
      uniform vec3 uMeadowMid;
      uniform vec3 uMeadowShade;
      uniform vec3 uLitterLit;
      uniform vec3 uLitterMid;
      uniform vec3 uLitterShade;
      uniform vec3 uSand;
      uniform vec3 uBedShallow;
      uniform vec3 uBedDeep;
      uniform float uLakeLevel;
      uniform vec3 uOrb;

      varying vec3 vWorld;
      varying vec3 vNormal;

      layout(location = 0) out vec4 fragColor;

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      void main() {
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 p = vWorld;
        float slope = 1.0 - n.y;

        // hand-painted bands: a dithered edge instead of a gradient
        float dither = hash21(floor(p.xz * 3.1));
        float forest = max(smoothstep(40.0, 62.0, -p.z), smoothstep(34.0, 60.0, abs(p.x)));
        float shore = 1.0 - smoothstep(0.08, 0.75, abs(p.y - uLakeLevel));
        float under = 1.0 - smoothstep(uLakeLevel - 0.08, uLakeLevel + 0.08, p.y);
        float steep = smoothstep(0.32, 0.8, slope);

        float tone = vnoise(p.xz * 0.13) * 0.7 + vnoise(p.xz * 0.33) * 0.3;
        vec3 meadow = mix(uMeadowMid, uMeadowLit, smoothstep(0.34, 0.72, tone + (dither - 0.5) * 0.16));
        // dry, sun-cured patches: the warm accent that keeps a field from reading flat
        float dry = smoothstep(0.52, 0.78, vnoise(p.xz * 0.07 + vec2(11.3, 4.7)));
        meadow = mix(meadow, vec3(0.46, 0.44, 0.24), dry * 0.55);
        meadow = mix(meadow, uMeadowShade, smoothstep(0.3, 0.95, slope) * 0.8);

        vec3 litter = mix(uLitterMid, uLitterLit, smoothstep(0.4, 0.62, tone + (dither - 0.5) * 0.3));
        litter = mix(litter, uLitterShade, smoothstep(0.25, 0.9, slope) * 0.75);

        vec3 ground = mix(meadow, litter, smoothstep(0.35, 0.75, forest + (dither - 0.5) * 0.18));
        ground = mix(ground, uSand, shore * 0.8);
        ground = mix(ground, mix(uBedShallow, uBedDeep, smoothstep(uLakeLevel - 0.4, uLakeLevel - 3.5, p.y)), under);
        ground = mix(ground, mix(uSand, uLitterMid, 0.45), steep * 0.5);

        // dappled canopy light in the forest, open light in the meadow
        float dapple = 0.88 + 0.12 * vnoise(p.xz * 1.6 + vec2(3.1, 7.4));
        ground *= mix(1.0, dapple, smoothstep(0.2, 0.8, forest));

        vec3 col = toonStep(ground, n);

        // the orb is the only local light in this world
        float od = length(p - uOrb);
        col += vec3(0.24, 0.17, 0.42) * exp(-od * od * 0.035) * 0.65;

        float dist = length(p - cameraPosition);
        col = applyHaze(col, dist, 120.0, 360.0);
        fragColor = vec4(col, 1.0);
      }
    `,
  })
}

/* ------------------------------- component -------------------------------- */

export function Terrain({ uniforms }: { uniforms: WorldUniforms }) {
  const geometry = useMemo(() => buildTerrainGeometry(), [])
  const material = useMemo(() => createTerrainMaterial(uniforms), [uniforms])

  return <mesh geometry={geometry} material={material} receiveShadow={false} castShadow={false} />
}
