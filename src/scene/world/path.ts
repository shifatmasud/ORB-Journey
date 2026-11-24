/**
 * The five beats as the app frames them.
 *
 * The lens is owned by Stream 4's `CameraRig`; these are the same five poses,
 * written down in world metres so the world can be laid against them (and so a
 * future camera pass has one table to compare with). The orb itself sits at the
 * origin, hovering over the middle of the pool — the camera falls towards it and
 * finally under the surface to look back up at it.
 *
 * Column: cloud base **y = 46**, ground **y = 0**, water line **y = −1.6**
 * (`LAKE_LEVEL`). Values match `src/scene/atmosphere/CameraRig.tsx` and
 * `src/scene/atmosphere/StageSlots.tsx`.
 */
import * as THREE from 'three'

export type Beat = {
  /** 0..4 */
  index: number
  camera: [number, number, number]
  target: [number, number, number]
  fov: number
  name: string
}

export const BEATS: readonly Beat[] = [
  { index: 0, camera: [0, 64, 30], target: [0, 44, -12], fov: 42, name: 'sky' },
  { index: 1, camera: [0.9, 30, 22], target: [0, 12, -9], fov: 45, name: 'meadow' },
  { index: 2, camera: [1.7, 6.1, 15], target: [0, 0.3, -6], fov: 47, name: 'bank' },
  { index: 3, camera: [0.5, 0.55, 11], target: [0, -1.3, -7], fov: 49, name: 'seam' },
  { index: 4, camera: [0, -6.2, 9], target: [0, 4.2, -4], fov: 53, name: 'deep' },
] as const

/** The orb's home: over the middle of the pool, 1.6 m above the water line. */
export const ORB_HOME = new THREE.Vector3(0, 0, 0)

/** Point the lens sits at, `p` in 0..1 (Catmull-Rom through the five poses). */
export function cameraAt(p: number): THREE.Vector3 {
  return spline(p, (b) => b.camera)
}

/** Point the lens looks at. */
export function cameraTargetAt(p: number): THREE.Vector3 {
  return spline(p, (b) => b.target)
}

/** The orb sits at its home for the whole journey; kept as a function so a
 *  moving orb can be wired in without touching the world. */
export function orbAt(_p: number): THREE.Vector3 {
  return ORB_HOME.clone()
}

function spline(p: number, pick: (b: Beat) => [number, number, number]): THREE.Vector3 {
  const pts = BEATS.map((b) => new THREE.Vector3(...pick(b)))
  const clamped = Math.max(0, Math.min(1, p))
  const scaled = clamped * (pts.length - 1)
  const i = Math.min(pts.length - 2, Math.floor(scaled))
  const t = scaled - i
  const a = pts[Math.max(0, i - 1)]
  const b = pts[i]
  const c = pts[i + 1]
  const d = pts[Math.min(pts.length - 1, i + 2)]
  const t2 = t * t
  const t3 = t2 * t
  const out = new THREE.Vector3()
  for (const key of ['x', 'y', 'z'] as const) {
    out[key] =
      0.5 *
      (2 * b[key] +
        (-a[key] + c[key]) * t +
        (2 * a[key] - 5 * b[key] + 4 * c[key] - d[key]) * t2 +
        (-a[key] + 3 * b[key] - 3 * c[key] + d[key]) * t3)
  }
  return out
}

/**
 * The vertical sightline the lens travels along, projected on the ground plane.
 * Plants are kept off this strip so nothing stands between the camera and the orb.
 */
export const SIGHTLINE: Array<[number, number]> = [
  [0, 22],
  [0, 14],
  [0, 4],
  [0, -6],
  [0, -20],
]

/** Distance from a point to the sightline strip (metres, ground plane). */
export function distanceToSightline(x: number, z: number): number {
  let best = Infinity
  for (let i = 0; i < SIGHTLINE.length - 1; i++) {
    const [ax, az] = SIGHTLINE[i]
    const [bx, bz] = SIGHTLINE[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const len = dx * dx + dz * dz
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0
    const px = ax + dx * t
    const pz = az + dz * t
    best = Math.min(best, Math.hypot(x - px, z - pz))
  }
  return best
}
