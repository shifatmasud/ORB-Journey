#!/usr/bin/env node
/**
 * ORB-Journey visual QA
 *
 * Serves `dist/` with `vite preview`, drives it in headless Chromium on the
 * ANGLE/SwiftShader (CPU) backend so the run is deterministic on a CI box with
 * no GPU, and captures desktop + mobile frames across scroll progress.
 *
 * Fails the run on any `console.error` or uncaught page error, and on a page
 * that did not come up on WebGL2.
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const PORT = Number(process.env.QA_PORT ?? 4173)
const BASE = `http://127.0.0.1:${PORT}/`
const OUT = path.resolve('artifacts')
const STOPS = [0, 0.25, 0.5, 0.75, 1]

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
]

const CHROMIUM_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--disable-gpu-sandbox',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error(`preview server did not answer at ${url} within ${timeoutMs}ms`)
}

function startPreview() {
  const child = spawn(
    'npm',
    ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } },
  )
  child.stdout.on('data', (chunk) => process.stdout.write(`[preview] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`))
  return child
}

function attachLogging(page, bucket, viewportName) {
  page.on('console', (message) => {
    const type = message.type()
    if (type === 'error') {
      bucket.push({ kind: 'console.error', viewport: viewportName, text: message.text() })
    } else if (type === 'warning' && process.env.QA_VERBOSE) {
      console.log(`[warn:${viewportName}] ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => {
    bucket.push({ kind: 'pageerror', viewport: viewportName, text: error.message })
  })
  page.on('requestfailed', (request) => {
    bucket.push({
      kind: 'requestfailed',
      viewport: viewportName,
      text: `${request.method()} ${request.url()} — ${request.failure()?.errorText ?? 'unknown'}`,
    })
  })
}

async function settle(page) {
  // Two animation frames plus a short beat: the R3F loop and framer-motion
  // scroll transforms both commit on rAF, and SwiftShader frames are slow.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 260)))
      }),
  )
}

async function scrollToProgress(page, progress) {
  const metrics = await page.evaluate((p) => {
    const max = document.documentElement.scrollHeight - window.innerHeight
    window.scrollTo(0, Math.round(max * p))
    return {
      max,
      y: Math.round(window.scrollY),
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }
  }, progress)
  await settle(page)
  return metrics
}

async function run() {
  await mkdir(OUT, { recursive: true })
  const errors = []
  const report = { generatedAt: new Date().toISOString(), base: BASE, viewports: {}, errors }

  const preview = startPreview()
  let browser
  try {
    await waitForServer(BASE)

    browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS })
    report.chromiumVersion = browser.version()

    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor,
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch,
        colorScheme: 'dark',
        reducedMotion: 'no-preference',
      })
      const page = await context.newPage()
      attachLogging(page, errors, viewport.name)

      await page.goto(BASE, { waitUntil: 'load' })
      await page.waitForFunction(() => window.__ORB_READY__ === true, undefined, { timeout: 60_000 })
      await page.evaluate(() => document.fonts?.ready)
      await settle(page)

      const gl = await page.evaluate(() => window.__ORB_GL__ ?? null)
      const webglAttr = await page.evaluate(() => document.documentElement.dataset.webgl ?? null)
      const canvasBox = await page.evaluate(() => {
        const canvas = document.querySelector('canvas')
        if (!canvas) return null
        const rect = canvas.getBoundingClientRect()
        return { width: Math.round(rect.width), height: Math.round(rect.height) }
      })

      report.viewports[viewport.name] = {
        viewport: { width: viewport.width, height: viewport.height, dpr: viewport.deviceScaleFactor },
        gl,
        webglAttribute: webglAttr,
        canvas: canvasBox,
        stops: [],
        shots: [],
      }

      if (webglAttr !== '2' || gl?.webgl2 !== true) {
        errors.push({
          kind: 'webgl2-missing',
          viewport: viewport.name,
          text: `expected WebGL2, got data-webgl="${webglAttr}" / gl=${JSON.stringify(gl)}`,
        })
      }
      if (!canvasBox || canvasBox.width < 100 || canvasBox.height < 100) {
        errors.push({
          kind: 'canvas-size',
          viewport: viewport.name,
          text: `canvas box was ${JSON.stringify(canvasBox)}`,
        })
      }

      for (const progress of STOPS) {
        const metrics = await scrollToProgress(page, progress)
        const file = path.join(OUT, `${viewport.name}-${Math.round(progress * 100)}.png`)
        await page.screenshot({ path: file, animations: 'allow' })
        report.viewports[viewport.name].shots.push(path.basename(file))
        report.viewports[viewport.name].stops.push({ progress, ...metrics })
      }

      // Hover + scrub: pointer parallax on the orb and a wheel scrub back up
      // the page, captured mid-scroll so both pointer and scroll inputs show.
      await scrollToProgress(page, 0.5)
      const cx = Math.round(viewport.width / 2)
      const cy = Math.round(viewport.height * 0.45)
      await page.mouse.move(cx, cy, { steps: 8 })
      await page.mouse.move(Math.round(viewport.width * 0.74), Math.round(viewport.height * 0.36), { steps: 12 })
      await settle(page)
      await page.screenshot({ path: path.join(OUT, `${viewport.name}-scrub-hover.png`) })
      report.viewports[viewport.name].shots.push(`${viewport.name}-scrub-hover.png`)

      await page.mouse.wheel(0, -420)
      await settle(page)
      await page.mouse.wheel(0, 640)
      await settle(page)
      await page.mouse.move(Math.round(viewport.width * 0.26), Math.round(viewport.height * 0.58), { steps: 10 })
      await settle(page)
      const scrubbed = await page.evaluate(() => Math.round(window.scrollY))
      await page.screenshot({ path: path.join(OUT, `${viewport.name}-scrub.png`) })
      report.viewports[viewport.name].shots.push(`${viewport.name}-scrub.png`)
      report.viewports[viewport.name].scrubScrollY = scrubbed

      await context.close()
    }
  } finally {
    if (browser) await browser.close()
    preview.kill('SIGTERM')
  }

  report.errorCount = errors.length
  await writeFile(path.join(OUT, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`)

  console.log(`\nORB-Journey visual QA — ${STOPS.length * VIEWPORTS.length + VIEWPORTS.length * 2} screenshots in ${OUT}`)
  for (const [name, data] of Object.entries(report.viewports)) {
    console.log(
      `  ${name}: WebGL2=${data.gl?.webgl2} renderer="${data.gl?.renderer}" glVersion="${data.gl?.version}" canvas=${data.canvas?.width}x${data.canvas?.height}`,
    )
  }

  if (errors.length > 0) {
    console.error(`\n${errors.length} page error(s):`)
    for (const error of errors) console.error(`  [${error.viewport}] ${error.kind}: ${error.text}`)
    process.exitCode = 1
    return
  }
  console.log('\nNo console.error / pageerror. WebGL2 confirmed on every viewport.')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
