import { motion, useTransform, type MotionValue } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * The pinned text slot — Surface Tension's `.slot`, ported (love-letter §1.4 / §1.8).
 *
 * The text never moves on its own: each line has a hard mask and its progress is derived from
 * scroll, so the words roll up through the mask as you scroll and roll out the top when the next
 * beat arrives. The reveal is `surface-tension`'s exact formula, line for line:
 *
 *     translate3d(0, (1 - v) * 102%, 0) skewX(2.52° · tl) scaleY(1 / (1 + 0.035 · |tl|))
 *     tl = clamp(1 - v, -1, 1)
 *
 * `v` runs 0 (under the mask) → 1 (in place) → 2 (gone through the top). A beat's arriving lines
 * start after its leaving lines have cleared their masks because the windows do not overlap.
 */

export type BeatCopy = {
  id: string
  eyebrow: string
  title: string[]
  body: string[]
}

/** [in-start, in-end, out-start, out-end] per beat, in scroll progress (0 → 1). */
const WINDOWS: [number, number, number, number][] = [
  [0, 0, 0.035, 0.105],
  [0.148, 0.223, 0.272, 0.345],
  [0.398, 0.473, 0.522, 0.595],
  [0.648, 0.723, 0.772, 0.845],
  [0.862, 0.935, 0.958, 0.995],
]

function Line({
  progress,
  window: range,
  index,
  children,
}: {
  progress: MotionValue<number>
  window: [number, number, number, number]
  index: number
  children: ReactNode
}) {
  const shift = index * 0.011
  const v = useTransform(
    progress,
    [range[0] + shift, range[1] + shift, range[2] + shift, range[3] + shift],
    [0, 1, 1, 2],
    { clamp: true },
  )
  const transform = useTransform(v, (value) => {
    const tl = Math.max(-1, Math.min(1, 1 - value))
    const y = ((1 - value) * 102).toFixed(2)
    return `translate3d(0, ${y}%, 0) skewX(${(2.52 * tl).toFixed(3)}deg) scaleY(${(
      1 /
      (1 + 0.035 * Math.abs(tl))
    ).toFixed(4)})`
  })
  const opacity = useTransform(v, (value) => (value >= 2 ? 0 : 1))
  return (
    <span className="slot__line">
      <motion.span className="slot__in" style={{ transform, opacity }}>
        {children}
      </motion.span>
    </span>
  )
}

export function BeatOverlay({ progress, beats }: { progress: MotionValue<number>; beats: BeatCopy[] }) {
  return (
    <div className="slot__beat" aria-live="polite">
      {beats.map((beat, beatIndex) => (
        <div className="slot__copy" key={beat.id} data-beat={beat.id}>
          <p className="slot__eyebrow">
            <Line progress={progress} window={WINDOWS[beatIndex]} index={0}>
              {beat.eyebrow}
            </Line>
          </p>
          {beatIndex === 0 ? (
            <h1 className="slot__title">
              {beat.title.map((line, i) => (
                <Line key={line} progress={progress} window={WINDOWS[beatIndex]} index={i + 1}>
                  {line}
                </Line>
              ))}
            </h1>
          ) : (
            <h2 className="slot__title">
              {beat.title.map((line, i) => (
                <Line key={line} progress={progress} window={WINDOWS[beatIndex]} index={i + 1}>
                  {line}
                </Line>
              ))}
            </h2>
          )}
          <p className="slot__body">
            {beat.body.map((line, i) => (
              <Line
                key={line}
                progress={progress}
                window={WINDOWS[beatIndex]}
                index={beatIndex === 0 ? i + 2 : i + 1 + beat.title.length}
              >
                {line}
              </Line>
            ))}
          </p>
        </div>
      ))}
    </div>
  )
}
