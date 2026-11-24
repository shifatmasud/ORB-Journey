import * as THREE from 'three'

/**
 * The five weather states of the journey and the scroll value they are sampled with.
 *
 * One table, sampled once per frame into a preallocated object, so the sky dome, the cloud layer,
 * the god-rays and the weather all read the same numbers (house rule 7: one clock, one value).
 * Colours are lifted from `love-letter/notes/style.md`: warm near-blacks, cream highlights, far
 * layers lighter and bluer, and no sun disc anywhere — the gradient carries the light.
 */

export type SkyState = {
  name: string
  zenith: string
  mid: string
  horizon: string
  sun: string
  haze: string
  land: string
  cloudLit: string
  cloudShade: string
  cloudRim: string
  sunDir: [number, number, number]
  sunPower: number
  /** haze thickness near the horizon */
  mist: number
  rain: number
  snow: number
  /** the cloud-sea plane */
  sea: number
  /** crepuscular shafts in the dome */
  shaft: number
  /** Snell's window / surface brightness overhead (underwater) */
  window: number
  /** 0 = light sky (ink nav), 1 = dark sky (cream nav) */
  tone: number
}

export const SKY_STATES: SkyState[] = [
  {
    // 01 · clouds & sky — golden morning mist, the sun still low on the left
    name: 'golden morning',
    zenith: '#5E7FA8',
    mid: '#A9B7BE',
    horizon: '#F2DDBB',
    sun: '#FFE7B5',
    haze: '#EFD9BC',
    land: '#C2C4B2',
    cloudLit: '#FFF3DD',
    cloudShade: '#D8C3BC',
    cloudRim: '#FFEFD0',
    sunDir: [-0.62, 0.4, -0.68],
    sunPower: 1,
    mist: 0.72,
    rain: 0,
    snow: 0,
    sea: 1,
    shaft: 0.5,
    window: 0,
    tone: 0,
  },
  {
    // 02 · falling into the meadow — sunlit breeze, high sun, clouds rushing up past the lens
    name: 'sunlit breeze',
    zenith: '#4C79AE',
    mid: '#93B7CC',
    horizon: '#E8F0EE',
    sun: '#FFF6DC',
    haze: '#DDE8E6',
    land: '#B6C4BA',
    cloudLit: '#FFFFFF',
    cloudShade: '#CDCFD9',
    cloudRim: '#FFF8E8',
    sunDir: [0.34, 0.55, -0.76],
    sunPower: 1.05,
    mist: 0.34,
    rain: 0,
    snow: 0,
    sea: 0.8,
    shaft: 0.72,
    window: 0,
    tone: 0,
  },
  {
    // 03 · forest bank & lakeside — soft rain, an overcast that keeps the greens
    name: 'soft rain',
    zenith: '#5E6A79',
    mid: '#8A939C',
    horizon: '#C2C4C2',
    sun: '#EDE7DA',
    haze: '#B9BEBC',
    land: '#9EA8A2',
    cloudLit: '#E8E9E6',
    cloudShade: '#8A8F98',
    cloudRim: '#D8DBD8',
    sunDir: [0.15, 0.34, -0.93],
    sunPower: 0.42,
    mist: 0.56,
    rain: 1,
    snow: 0,
    sea: 0.45,
    shaft: 0.22,
    window: 0,
    tone: 0,
  },
  {
    // 04 · the air–water split line — a low sun, still air, the water already dark below
    name: 'twilight seam',
    zenith: '#24304A',
    mid: '#5F5566',
    horizon: '#DCA97E',
    sun: '#FFCE96',
    haze: '#C89A78',
    land: '#2F4142',
    cloudLit: '#F0D2B4',
    cloudShade: '#7A6672',
    cloudRim: '#FFD9A8',
    sunDir: [-0.42, 0.1, -0.9],
    sunPower: 0.5,
    mist: 0.7,
    rain: 0,
    snow: 0.15,
    sea: 0.12,
    shaft: 0.5,
    window: 0,
    tone: 1,
  },
  {
    // 05 · the dive — bright window overhead, deep teal everywhere else
    name: 'the dive',
    zenith: '#2E7F88',
    mid: '#11505A',
    horizon: '#062028',
    sun: '#EAFBF4',
    haze: '#2E7E85',
    land: '#082830',
    cloudLit: '#63AEB4',
    cloudShade: '#0C3A45',
    cloudRim: '#A8E3DC',
    sunDir: [0.05, 1, -0.12],
    sunPower: 1.0,
    mist: 0.22,
    rain: 0,
    snow: 1,
    sea: 0,
    shaft: 0.85,
    window: 1,
    tone: 1,
  },
]

export type Atmosphere = {
  zenith: THREE.Color
  mid: THREE.Color
  horizon: THREE.Color
  sun: THREE.Color
  haze: THREE.Color
  land: THREE.Color
  cloudLit: THREE.Color
  cloudShade: THREE.Color
  cloudRim: THREE.Color
  sunDir: THREE.Vector3
  sunPower: number
  mist: number
  rain: number
  snow: number
  sea: number
  shaft: number
  window: number
  tone: number
  /** the sky's own brightness, for the nav tone switch */
  luma: number
  name: string
}

const scratch = new THREE.Color()

export function createAtmosphere(): Atmosphere {
  const first = SKY_STATES[0]
  return {
    zenith: new THREE.Color(first.zenith),
    mid: new THREE.Color(first.mid),
    horizon: new THREE.Color(first.horizon),
    sun: new THREE.Color(first.sun),
    haze: new THREE.Color(first.haze),
    land: new THREE.Color(first.land),
    cloudLit: new THREE.Color(first.cloudLit),
    cloudShade: new THREE.Color(first.cloudShade),
    cloudRim: new THREE.Color(first.cloudRim),
    sunDir: new THREE.Vector3(...first.sunDir),
    sunPower: first.sunPower,
    mist: first.mist,
    rain: first.rain,
    snow: first.snow,
    sea: first.sea,
    shaft: first.shaft,
    window: first.window,
    tone: first.tone,
    luma: 0.5,
    name: first.name,
  }
}

const mix = (a: number, b: number, f: number) => a + (b - a) * f
const smooth = (f: number) => f * f * (3 - 2 * f)

/** One shared sample of the current weather, rewritten every frame by whichever layer runs first. */
export const atmosphere: Atmosphere = createAtmosphere()

/** u: 0 → 4 across the five beats. */
export function sampleAtmosphere(u: number, out: Atmosphere = atmosphere) {
  const clamped = Math.min(SKY_STATES.length - 1, Math.max(0, u))
  const i = Math.min(SKY_STATES.length - 2, Math.floor(clamped))
  const f = smooth(Math.min(1, Math.max(0, clamped - i)))
  const a = SKY_STATES[i]
  const b = SKY_STATES[i + 1]

  const lerp = (key: 'zenith' | 'mid' | 'horizon' | 'sun' | 'haze' | 'land' | 'cloudLit' | 'cloudShade' | 'cloudRim') => {
    scratch.set(a[key])
    out[key].copy(scratch).lerp(scratch.set(b[key]), f)
  }
  lerp('zenith')
  lerp('mid')
  lerp('horizon')
  lerp('sun')
  lerp('haze')
  lerp('land')
  lerp('cloudLit')
  lerp('cloudShade')
  lerp('cloudRim')

  out.sunDir.set(
    mix(a.sunDir[0], b.sunDir[0], f),
    mix(a.sunDir[1], b.sunDir[1], f),
    mix(a.sunDir[2], b.sunDir[2], f),
  ).normalize()

  out.sunPower = mix(a.sunPower, b.sunPower, f)
  out.mist = mix(a.mist, b.mist, f)
  out.rain = mix(a.rain, b.rain, f)
  out.snow = mix(a.snow, b.snow, f)
  out.sea = mix(a.sea, b.sea, f)
  out.shaft = mix(a.shaft, b.shaft, f)
  out.window = mix(a.window, b.window, f)
  out.tone = mix(a.tone, b.tone, f)
  out.name = f < 0.5 ? a.name : b.name
  out.luma = 0.2126 * out.horizon.r + 0.7152 * out.horizon.g + 0.0722 * out.horizon.b
}

/**
 * The scene clock: the camera spline is the only writer, every other layer reads.
 * Keeping it out of React avoids a re-render per scroll frame.
 */
export const journey = {
  /** 0 → 4 across the five beats */
  u: 0,
  /** 0 → 1 document scroll */
  p: 0,
  beat: 0,
  time: 0,
}
