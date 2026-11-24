import { createElement } from 'react'
import { AtmosphericDust } from './AtmosphericDust'
import { GpgpuRings } from './GpgpuRings'
import { PurpleOrb } from './PurpleOrb'
import type { OrbNumberRef, OrbPointer, OrbPointerRef } from './PurpleOrb'

/**
 * Stream 1 — the orb and everything it carries.
 *
 * `OrbScene` is the whole stream in one element: the amethyst core, the three
 * GPGPU orbital rings and the atmospheric dust. It reads the page's scroll and
 * pointer through refs (never through props or state), so scrolling never
 * re-renders React and the scene can never jitter against the page.
 *
 * ```tsx
 * const progressRef = useRef(0)                 // 0..1, one writer per frame
 * const pointerRef = useRef<OrbPointer | null>(null) // -1..1 NDC, null = untouched
 * <OrbScene progressRef={progressRef} pointerRef={pointerRef} tier={tier} />
 * ```
 */

export type OrbTier = 'low' | 'high'

export type OrbSceneProps = {
  /** Scroll progress 0..1 for the whole journey. */
  progressRef: OrbNumberRef
  /** Pointer in -1..1 screen units; `null` while it has not moved. */
  pointerRef: OrbPointerRef
  /** `low` halves the ring and dust counts (phones); the orb is unchanged. */
  tier: OrbTier
}

// No JSX here on purpose: this stays a plain `.ts` module.
export function OrbScene({ progressRef, pointerRef, tier }: OrbSceneProps) {
  return createElement(
    'group',
    { name: 'orb' },
    createElement(PurpleOrb, { progressRef, pointerRef }),
    createElement(GpgpuRings, { progressRef, pointerRef, tier }),
    createElement(AtmosphericDust, { progressRef, pointerRef, tier }),
  )
}

export { AtmosphericDust, GpgpuRings, PurpleOrb }
export type { OrbNumberRef, OrbPointer, OrbPointerRef }
