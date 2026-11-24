import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useMotionValueEvent, useScroll } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Soundscape } from './audio/Soundscape'
import { createWebGL2Context, describeRenderer, type RendererInfo } from './gl/webgl2'
import { CameraRig } from './scene/atmosphere/CameraRig'
import { OrbSlot, WaterSlot, WorldSlot } from './scene/atmosphere/StageSlots'
import { SkyCloudsGodrays } from './scene/atmosphere/SkyCloudsGodrays'
import { WeatherSystem } from './scene/atmosphere/WeatherSystem'
import { atmosphere, journey, sampleAtmosphere } from './scene/atmosphere/atmosphereState'
import { capDpr, TIER } from './scene/atmosphere/quality'
import { BeatOverlay, type BeatCopy } from './ui/BeatOverlay'
import { Footer } from './ui/Footer'
import { Header } from './ui/Header'
import { Preloader } from './ui/Preloader'

declare global {
  interface Window {
    /** Set once the loader has slid away and the first frame is on screen. */
    __ORB_READY__?: boolean
    /** WebGL2 implementation details, read by visual QA. */
    __ORB_GL__?: RendererInfo
    /** Frames actually drawn — the screenshot harness waits on this, not on a timer. */
    __ORB_FRAME__?: number
  }
}

/**
 * `?qa=1` keeps the drawing buffer after compositing. Only the screenshot harness
 * asks for it: on a CPU rasterizer a frame can take longer than the compositor's
 * hold, and a capture then lands on an already-cleared buffer (a black frame that
 * looks like a scene failure). Real visitors keep the cheaper default.
 */
const QA_BUFFER = new URLSearchParams(window.location.search).has('qa')

/**
 * The five beats. Copy follows love-letter's register: an eyebrow `NN — The place`, a title of four
 * words or fewer, and one or two quiet sentences.
 */
const BEATS: BeatCopy[] = [
  {
    id: 'sky',
    eyebrow: '01 — The sky',
    title: ['A small', 'light'],
    body: ['Up where the air is thin and gold.', 'The clouds open. It starts to fall.'],
  },
  {
    id: 'meadow',
    eyebrow: '02 — The meadow',
    title: ['Down through', 'the green'],
    body: ['Cloud shade, and then grass.', 'The fall slows. The field leans up.'],
  },
  {
    id: 'bank',
    eyebrow: '03 — The bank',
    title: ['Where the', 'forest ends'],
    body: ['Pines thin out to reeds.', 'The light comes down to the water.'],
  },
  {
    id: 'seam',
    eyebrow: '04 — The seam',
    title: ['One line', 'of air'],
    body: ['Air above, water below, one seam.', 'It moves when you move.'],
  },
  {
    id: 'deep',
    eyebrow: '05 — The deep',
    title: ['Under', 'the light'],
    body: ['Kelp, cold blue, one window of sun.', 'It keeps going down into the quiet.'],
  },
]

/** Reports WebGL2 and the first drawn frame; `__ORB_READY__` waits for the loader to leave. */
function ReadyProbe({ onFirstFrame }: { onFirstFrame: () => void }) {
  const gl = useThree((state) => state.gl)
  const reported = useRef(false)
  useFrame(() => {
    if (reported.current) return
    reported.current = true
    const info = describeRenderer(gl)
    window.__ORB_GL__ = info
    document.documentElement.dataset.webgl = info.webgl2 ? '2' : '1'
    document.documentElement.dataset.orbTier = TIER
    onFirstFrame()
  })
  return null
}

/** Keeps the nav's colour honest: cream over the dark dives, ink over the light sky. */
function ToneProbe({ onChange }: { onChange: (onDark: boolean) => void }) {
  const last = useRef(true)
  useFrame(() => {
    sampleAtmosphere(journey.u)
    window.__ORB_FRAME__ = (window.__ORB_FRAME__ ?? 0) + 1
    const dark = atmosphere.tone > 0.5
    document.documentElement.dataset.orbU = journey.u.toFixed(2)
    document.documentElement.dataset.orbTone = dark ? 'dark' : 'light'
    if (dark !== last.current) {
      last.current = dark
      onChange(dark)
    }
  })
  return null
}

export default function App() {
  const { scrollYProgress } = useScroll()
  const [muted, setMuted] = useState(() => Soundscape.isMuted())
  const [onDark, setOnDark] = useState(true)
  const [fonts, setFonts] = useState(false)
  const [framed, setFramed] = useState(false)
  const [grace, setGrace] = useState(false)
  const [forced, setForced] = useState(false)
  const footSpace = useRef<HTMLDivElement>(null)

  const done = (framed && (fonts || grace)) || forced

  // the soundscape follows the same scroll value as the camera, with the reference's slow constant
  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    Soundscape.mix(Math.min(4, Math.max(0, value * 4)))
  })

  useEffect(() => {
    document.documentElement.classList.add('pre-lock')
    Soundscape.mix(0)
    const graceTimer = window.setTimeout(() => setGrace(true), 900)
    const hardStop = window.setTimeout(() => setForced(true), 7000)
    document.fonts?.ready.then(() => setFonts(true)).catch(() => setFonts(true))
    return () => {
      window.clearTimeout(graceTimer)
      window.clearTimeout(hardStop)
    }
  }, [])

  // the footer curtain opens by exactly the footer's own height
  useEffect(() => {
    const footer = document.querySelector('footer')
    const space = footSpace.current
    if (!footer || !space) return
    const update = () => {
      space.style.height = `${footer.offsetHeight}px`
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(footer)
    return () => observer.disconnect()
  }, [])

  const onFirstFrame = useCallback(() => setFramed(true), [])

  const onLoaderReveal = useCallback(() => {
    document.documentElement.classList.remove('pre-lock')
  }, [])

  const onLoaderGone = useCallback(() => {
    document.documentElement.dataset.orbReady = 'true'
    window.__ORB_READY__ = true
  }, [])

  const toggleSound = useCallback(() => {
    Soundscape.boot()
    const next = !Soundscape.isMuted()
    Soundscape.setMuted(next)
    setMuted(next)
  }, [])

  const onStageMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // the seam answers the pointer: a quiet crystalline ring, panned where the hand is
    if (journey.u < 2.7) return
    const pan = (event.clientX / window.innerWidth - 0.5) * 1.6
    Soundscape.ripple(pan, 0.55)
  }, [])

  const onStageWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (journey.u < 2.7) return
    Soundscape.ripple((Math.random() * 2 - 1) * 0.7, 0.35 + Math.min(0.6, Math.abs(event.deltaY) / 900))
  }, [])

  const dpr = capDpr()

  return (
    <div className="app" data-testid="app">
      <Header onDark={onDark} muted={muted} onSound={toggleSound} />

      <div className="sheet">
        <div className="stage" onPointerMove={onStageMove} onWheel={onStageWheel}>
          <div className="canvas-layer">
            <Canvas
              dpr={dpr}
              camera={{ position: [0, 92, 34], fov: 42, near: 0.5, far: 1600 }}
              gl={(canvas: HTMLCanvasElement | OffscreenCanvas) => {
                const element = canvas as HTMLCanvasElement
                return new THREE.WebGLRenderer({
                  canvas: element,
                  context: createWebGL2Context(element, { antialias: true, alpha: false }),
                  antialias: true,
                  alpha: false,
                  preserveDrawingBuffer: QA_BUFFER,
                  powerPreference: 'high-performance',
                  failIfMajorPerformanceCaveat: false,
                })
              }}
              fallback={<div className="canvas-fallback">This journey needs WebGL2.</div>}
            >
              <CameraRig progress={scrollYProgress} />
              <SkyCloudsGodrays />
              <WeatherSystem />
              <OrbSlot progress={scrollYProgress} />
              <WorldSlot progress={scrollYProgress} />
              <WaterSlot progress={scrollYProgress} />
              <ambientLight intensity={0.55} />
              <directionalLight position={[6, 14, 8]} intensity={1.1} color="#FFF1D8" />
              <ReadyProbe onFirstFrame={onFirstFrame} />
              <ToneProbe onChange={setOnDark} />
            </Canvas>
          </div>
          <div className="vig" aria-hidden="true" />
          <div className="grain" aria-hidden="true" />
          <div className="scrim" aria-hidden="true" />
        </div>

        <main className="beats">
          {BEATS.map((beat, index) => (
            <section key={beat.id} className="beat" data-beat={index} aria-hidden="true" />
          ))}
        </main>

        <BeatOverlay progress={scrollYProgress} beats={BEATS} />
      </div>

      <div className="foot-space" ref={footSpace} aria-hidden="true" />
      <Footer />
      <Preloader
        progress={framed ? 1 : fonts ? 0.82 : 0.45}
        done={done}
        onReveal={onLoaderReveal}
        onGone={onLoaderGone}
      />
    </div>
  )
}
