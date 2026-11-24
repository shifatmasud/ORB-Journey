import { useFrame, useThree } from '@react-three/fiber'
import { useMemo } from 'react'
import type { MotionValue } from 'framer-motion'
import * as THREE from 'three'
import { journey } from './atmosphereState'
import { REDUCED_MOTION } from './quality'

/**
 * The one camera of the journey — a craning spline, not per-layer parallax.
 *
 * `love-letter` moves the *scene* under a fixed lens; ORB-Journey has a vertical world column
 * (cloud base → bank → waterline → deep), so the lens itself rides a Catmull-Rom spline whose
 * five control points are the five beats, and the scene stays where it is. A critically damped
 * spring (`w = 3 rad/s`, sub-stepped at 120 Hz so a 8 fps phone behaves like a 60 fps laptop)
 * carries the pointer parallax on top, capped at 0.32 / 0.16 of the frame like the reference.
 */

const POSES = [
  { pos: [0, 92, 34], target: [0, 86, -90], fov: 40 }, // 01 above the cloud sea
  { pos: [0.9, 30, 22], target: [0, 26, -70], fov: 45 }, // 02 falling through the cloud layer
  { pos: [1.7, 6.1, 15], target: [0, 3.4, -50], fov: 47 }, // 03 over the bank
  { pos: [0.5, 0.55, 11], target: [0, -0.8, -45], fov: 49 }, // 04 level with the seam
  { pos: [0, -6.2, 9], target: [0, 9.5, -30], fov: 53 }, // 05 under the surface, looking up
] as const

/** Critically damped follow, integrated in fixed sub-steps (surface-tension `Spring`, §2.6). */
class Damped {
  value: number
  velocity = 0
  constructor(
    initial: number,
    readonly omega = 3,
  ) {
    this.value = initial
  }
  step(target: number, dt: number) {
    const n = Math.max(1, Math.ceil(dt * 120))
    const h = dt / n
    for (let i = 0; i < n; i++) {
      const accel = this.omega * this.omega * (target - this.value) - 2 * this.omega * this.velocity
      this.velocity += accel * h
      this.value += this.velocity * h
    }
    return this.value
  }
}

export function CameraRig({ progress }: { progress: MotionValue<number> }) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera
  const rig = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(POSES.map((pose) => new THREE.Vector3(...pose.pos)), false, 'centripetal')
    const targets = new THREE.CatmullRomCurve3(POSES.map((pose) => new THREE.Vector3(...pose.target)), false, 'centripetal')
    return {
      curve,
      targets,
      pos: new THREE.Vector3(...POSES[0].pos),
      look: new THREE.Vector3(...POSES[0].target),
      parX: new Damped(0),
      parY: new Damped(0),
    }
  }, [])

  useFrame((state, delta) => {
    const dt = Math.min(0.05, delta)
    const p = Math.min(1, Math.max(0, progress.get()))
    const u = p * 4
    journey.u = u
    journey.p = p
    journey.beat = Math.round(u)
    journey.time = state.clock.elapsedTime

    const t = Math.min(0.9999, u / 4)
    rig.curve.getPoint(t, rig.pos)
    rig.targets.getPoint(t, rig.look)

    const pointer = REDUCED_MOTION ? { x: 0, y: 0 } : state.pointer
    const px = rig.parX.step(pointer.x * 0.32, dt)
    const py = rig.parY.step(pointer.y * 0.16, dt)

    camera.position.set(rig.pos.x + px, rig.pos.y + py, rig.pos.z)
    rig.look.x += px * 0.25
    rig.look.y += py * 0.2
    camera.lookAt(rig.look)

    const i = Math.min(POSES.length - 2, Math.floor(u))
    const f = Math.min(1, Math.max(0, u - i))
    const wantFov = POSES[i].fov + (POSES[i + 1].fov - POSES[i].fov) * (f * f * (3 - 2 * f))
    if (Math.abs(camera.fov - wantFov) > 0.01) {
      camera.fov = wantFov
      camera.updateProjectionMatrix()
    }
  })

  return null
}
