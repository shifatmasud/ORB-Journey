# ORB-Journey

A scroll-driven WebGL2 journey. React 18 + React Three Fiber v8 + three + framer-motion, built with Vite.

The renderer is created explicitly as a **WebGL2** context (`src/gl/webgl2.ts`) and shaders are authored in
**GLSL ES 3.00** (`#version 300 es`, `in` / `out` / `texture()`), so nothing here falls back to WebGL1 or
takes a WebGPU/TSL path.

## Stack

| | |
| --- | --- |
| `react`, `react-dom` | `^18.3.1` |
| `@react-three/fiber` | `^8.17.10` (R3F v8) |
| `three` | `^0.187.0` |
| `framer-motion` | `^14` (the `framer-motion` package, not `motion/react`) |
| `vite`, `@vitejs/plugin-react`, `typescript` | build toolchain |

## Scripts

```bash
npm install
npm run dev        # local dev server
npm run build      # tsc --noEmit && vite build
npm run preview    # serve dist/
npm run qa:visual  # headless SwiftShader screenshots of dist/
```

## Visual QA

`.github/workflows/visual-qa.yml` runs on every push to `main` and on `workflow_dispatch`:

1. `npm ci`, `npm run build`
2. `npx playwright install --with-deps chromium`
3. `npm run qa:visual` — serves `dist/` with `vite preview`, launches headless Chromium with
   `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, and captures:
   - Desktop `1440×900` and mobile `390×844` at scroll progress `0% / 25% / 50% / 75% / 100%`
   - a hover + wheel-scrub pass at mid-scroll
4. Fails on any `console.error` or `pageerror`, or if the page did not come up on WebGL2
   (`document.documentElement.dataset.webgl` must be `"2"`).
5. Uploads `artifacts/` (screenshots + `qa-report.json`) as a workflow artifact.

## Layout

```
index.html
src/main.tsx            boot
src/App.tsx             scroll stage: pinned WebGL2 canvas + framer-motion beats
src/gl/webgl2.ts        explicit WebGL2 context + renderer info
src/scene/rimMaterial.ts GLSL3 fresnel rim shader
scripts/visual-qa.mjs   Playwright capture harness
```
