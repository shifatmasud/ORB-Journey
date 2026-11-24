import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { createWebGL2Context, describeRenderer, type RendererInfo } from './gl/webgl2'
import { createRimMaterial } from './scene/rimMaterial'

declare global {
  interface Window {
    /** Set true after the first WebGL2 frame has been drawn. */
    __ORB_READY__?: boolean
    /** WebGL2 implementation details, read by visual QA. */
    __ORB_GL__?: RendererInfo
  }
}

const BEATS = [
  { step: '00', label: 'Origin', line: 'A small sphere of light, held still.' },
  { step: '01', label: 'Drift', line: 'It leaves the dark without asking.' },
  { step: '02', label: 'Field', line: 'Rings fold outward into weather.' },
  { step: '03', label: 'Split', line: 'Air above, water below, one seam.' },
  { step: '04', label: 'Arrival', line: 'The journey ends on a held breath.' },
] as const

function Orb({ progress }: { progress: MotionValue<number> }) {
  const group = useRef<THREE.Group>(null)
  const rings = useRef<THREE.Group>(null)
  const rim = useMemo(() => createRimMaterial(), [])

  useFrame((state) => {
    const p = progress.get()
    const g = group.current
    if (!g) return

    const t = state.clock.elapsedTime
    g.rotation.y = p * Math.PI * 2 + t * 0.12
    g.rotation.x = Math.sin(p * Math.PI) * 0.22
    g.rotation.z = -state.pointer.x * 0.14
    g.position.x = state.pointer.x * 0.18
    g.position.y = Math.sin(p * Math.PI) * 0.1 + state.pointer.y * 0.08
    g.scale.setScalar(1 + p * 0.16)

    const r = rings.current
    if (r) {
      r.rotation.z = -t * 0.18 - p * Math.PI
      r.rotation.x = Math.PI / 2.6 + Math.sin(t * 0.2) * 0.05
      r.scale.setScalar(0.94 + p * 0.2)
    }
  })

  return (
    <group ref={group}>
      <mesh>
        <icosahedronGeometry args={[0.62, 6]} />
        <meshStandardMaterial
          color="#6F55F5"
          roughness={0.42}
          metalness={0.24}
          emissive="#2A1768"
          emissiveIntensity={0.55}
        />
      </mesh>
      <mesh scale={1.035} material={rim}>
        <icosahedronGeometry args={[0.62, 6]} />
      </mesh>
      <group ref={rings}>
        <mesh>
          <torusGeometry args={[1.12, 0.0035, 10, 220]} />
          <meshBasicMaterial color="#CDC2FF" transparent opacity={0.5} />
        </mesh>
        <mesh rotation={[0.5, 0.2, 0.9]}>
          <torusGeometry args={[1.32, 0.0025, 10, 220]} />
          <meshBasicMaterial color="#8F7BFF" transparent opacity={0.3} />
        </mesh>
      </group>
    </group>
  )
}

function ReadyProbe() {
  const gl = useThree((state) => state.gl)
  const reported = useRef(false)

  useFrame(() => {
    if (reported.current) return
    reported.current = true
    const info = describeRenderer(gl)
    window.__ORB_GL__ = info
    window.__ORB_READY__ = true
    document.documentElement.dataset.orbReady = 'true'
    document.documentElement.dataset.webgl = info.webgl2 ? '2' : '1'
  })

  return null
}

export default function App() {
  const { scrollYProgress } = useScroll()

  // Each beat is fully opaque exactly at its QA stop (0 / 25 / 50 / 75 / 100 %).
  const beatOpacity = [
    useTransform(scrollYProgress, [0, 0, 0.17, 0.225], [1, 1, 1, 0]),
    useTransform(scrollYProgress, [0.18, 0.225, 0.275, 0.32], [0, 1, 1, 0]),
    useTransform(scrollYProgress, [0.455, 0.5, 0.5, 0.545], [0, 1, 1, 0]),
    useTransform(scrollYProgress, [0.68, 0.725, 0.775, 0.82], [0, 1, 1, 0]),
    useTransform(scrollYProgress, [0.955, 0.98, 1, 1], [0, 1, 1, 1]),
  ]
  const beatLift = [
    useTransform(scrollYProgress, [0, 0.225], [0, -16]),
    useTransform(scrollYProgress, [0.18, 0.32], [16, -16]),
    useTransform(scrollYProgress, [0.455, 0.545], [16, -16]),
    useTransform(scrollYProgress, [0.68, 0.82], [16, -16]),
    useTransform(scrollYProgress, [0.955, 1], [16, 0]),
  ]

  return (
    <div className="app" data-testid="app">
      <div className="stage">
        <div className="canvas-layer">
          <Canvas
            dpr={[1, 2]}
            camera={{ position: [0, 0.12, 4.1], fov: 40, near: 0.1, far: 40 }}
            gl={(canvas: HTMLCanvasElement | OffscreenCanvas) => {
              const element = canvas as HTMLCanvasElement
              return new THREE.WebGLRenderer({
                canvas: element,
                context: createWebGL2Context(element, { antialias: true, alpha: false }),
                antialias: true,
                alpha: false,
                powerPreference: 'high-performance',
                failIfMajorPerformanceCaveat: false,
              })
            }}
            fallback={
              <div className="canvas-fallback">
                This journey needs WebGL2.
              </div>
            }
          >
            <color attach="background" args={['#08090E']} />
            <ambientLight intensity={0.42} />
            <directionalLight position={[3, 4, 2]} intensity={1.5} color="#E4DCFF" />
            <directionalLight position={[-3, 0.5, -2.5]} intensity={1.1} color="#7C63FF" />
            <pointLight position={[-3.5, -1.5, 2.5]} intensity={5} color="#5B3BFF" distance={12} />
            <Orb progress={scrollYProgress} />
            <ReadyProbe />
          </Canvas>
        </div>

        <div className="veil" aria-hidden />
        <div className="scrim" aria-hidden />
        <div className="grain" aria-hidden />

        <header className="topbar">
          <span className="mark">ORB</span>
          <span className="mark mark--muted">Journey / WebGL2</span>
        </header>

        <div className="beats">
          {BEATS.map((beat, index) => (
            <motion.div
              key={beat.step}
              className="beat"
              data-testid={`beat-${beat.step}`}
              style={{ opacity: beatOpacity[index], y: beatLift[index] }}
            >
              <span className="beat__step">
                {beat.step} — {beat.label}
              </span>
              <h2 className="beat__line">{beat.line}</h2>
            </motion.div>
          ))}
        </div>

        <div className="hud" aria-hidden>
          <span className="hud__label">Scroll</span>
          <div className="hud__track">
            <motion.div className="hud__bar" style={{ scaleX: scrollYProgress }} />
          </div>
        </div>
      </div>

      <div className="scroll-track" data-testid="scroll-track" />
    </div>
  )
}
