# Stream 3 — lake water, hover/scrub trails, the air–water seam, kelp forest

Everything in this folder is self-contained: no file outside `src/scene/water/`
was touched. Mount it with one component inside the journey's Canvas.

```tsx
import { WaterBeat } from './scene/water'

const orb = useRef<THREE.Group>(null)
// ...inside <Canvas>, under the orb:
<WaterBeat
  orbRef={orb}                 // the lake splashes it in and bobs it while it floats
  lake={{ level: 0, center: [0, 0], size: 180, depth: 7.5, basinRadius: 52 }}
  tier={low ? 'low' : 'high'}  // 'low' halves the trail field and the sheet's vertices
  sunDir={new THREE.Vector3(0.42, 0.62, 0.46)}
/>
```

The camera has to actually cross `level` in Beat 4 → Beat 5. Everything above the
surface is silent: while the lens is more than `splitOut` (default 0.9 m) above
the water, the line solver does not run and the seam pass is invisible.

## Files

| File | What it is | Reused from |
|---|---|---|
| `caustics.ts` | baked periodic Voronoi/ridged caustic tile (generated once on the CPU) + the Beer-Lambert medium GLSL every water material includes | shade-verse `caustics.ts` (two drifting copies, `min()`, per-channel fringe) |
| `WaterTrailFBO.ts` | ping-pong half-float heightfield (`R` height, `G` velocity), fixed 60 Hz ticks, swept-capsule strokes, orb splash/bob | surface-tension `RippleSim.ts` |
| `LakeWater.tsx` | Gerstner sheet (per-vertex, gradient + Jacobian to the fragment), exact Fresnel, Beer-Lambert refraction to the bed, sky/orb/shore reflection, Snell window from below, the split cut | shade-verse `oceanShader.ts` §4.2, `lens.ts` §4.3 |
| `AirWaterSplit.tsx` | per-column waterline solver (25 columns, depth ladder, 2 fixed-point iterations, 2 cm bias) + one additive pass for the meniscus and the god-rays | shade-verse `waterline.ts`, `post.ts` (`uwRays`) |
| `KelpForest.tsx` | one merged geometry: stipes, corrugated blades, pneumatocysts, holdfasts; vertex sway, 3-step cylindrical shading, caustic dapple, Beer-Lambert tint | REFERENCES §15 (Macrocystis), house toon rules |
| `WaterBeat.tsx` | the composition + the one clock that drives the caustic pattern | — |

## Knobs worth knowing

- `LakeConfig.depth` / `basinRadius` / `bedAt(x, z)` — the bed. If Stream 2's
  terrain already defines the basin, pass its height function as `bedAt` so the
  refracted bed and the kelp holdfasts sit on the real ground.
- `LakeConfig.splitOut` — camera height (m) where the split view is fully over.
- `KelpOptions` — `count`, `radius`, `height`, `clearance` (gap to the surface),
  `seed` (deterministic QA).
- `WaterTrailOptions.extent` — the square of lake the interactive field covers
  (defaults to 64 m around the lake centre; 256² on desktop, 128² on `low`).
- `WaterBeat` palette — `deep`, `shallow`, `skyHorizon`, `skyZenith`, `sun`, `shore`.

## Traits kept from the source repos

- WebGL2 + GLSL3 only; custom shaders do their own sRGB transfer (`uwSrgb`) —
  three only appends it to built-in materials.
- One wave table drives the GPU sheet and the CPU waterline solver, so the line
  can never disagree with the drawn surface.
- The trail field is anchored in world space, so a ring stays where it was made
  while the camera cranes over it.
- Caustics are a *baked tile* (two drifting copies, `min()`, ±0.0013 UV fringe).
  A per-pixel Voronoi cost seconds per frame under SwiftShader and has no place
  on a phone.
- The seam pass only ever *adds* light (additive blending). It cannot darken a
  frame by accident; the underwater medium belongs to the materials themselves.
