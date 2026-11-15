"use client"

import { type RefObject, useEffect, useMemo, useRef } from "react"
import { type ChartContextValue, useChart } from "./chart-context"
import {
  backingSize,
  bloomLayerStyle,
  easeInOutCubic,
  HOVER_FRAME_MS,
  IDLE_FRAME_MS,
  paintColumn,
  paintGlow,
  paintSheen,
  prefersReducedMotion,
  resample,
  sheenAt,
  SHEEN_PEAK,
} from "./dither-paint"
import { calmMotion, onMotionChange } from "./motion"
import { rgb } from "./palette"
import { scheduleCanvas, type CanvasScheduler } from "./canvas-scheduler"

type Star = { key: string; xi: number; depth: number; phase: number }
type Surface = { top: number[]; floor: number[] }

type LoopArgs = {
  canvas: HTMLCanvasElement
  bloomCanvas: HTMLCanvasElement | null
  cols: number
  rows: number
  state: RefObject<ChartContextValue>
  targets: RefObject<Record<string, Surface>>
  stars: RefObject<Star[]>
}

/**
 * On-demand painter — eases each series toward its target
 * surface, paints the dither fill (with the entrance reveal), then layers the
 * crosshair marker, glints and the living-light pass on top. Lives outside the
 * component so the component stays small and this hot closure isn't re-created
 * on every render. Returns a scheduler that pauses when idle, hidden, or
 * outside the viewport.
 */
function startCartesianLoop({
  canvas,
  bloomCanvas,
  cols,
  rows,
  state,
  targets,
  stars,
}: LoopArgs): CanvasScheduler | undefined {
  const c = canvas.getContext("2d")
  if (!c || cols <= 0 || rows <= 0) return undefined
  canvas.width = cols
  canvas.height = rows

  // Two cached fill layers: `0` is the resting weight, `1` the hover lift.
  // Painting both lets the hover fade be a two-image blend per frame instead of
  // a full dither repaint, which is what made the eased lift janky before.
  const liftCanvas: HTMLCanvasElement[] = []
  const liftCtx: CanvasRenderingContext2D[] = []
  for (let i = 0; i < 2; i++) {
    const cv = document.createElement("canvas")
    cv.width = cols
    cv.height = rows
    const cx = cv.getContext("2d")
    if (!cx) return undefined
    liftCanvas.push(cv)
    liftCtx.push(cx)
  }

  // The crisp fill at the current lift, *without* the pointer overlays, light or
  // glints. Each frame re-blits it (see the `copy` restore in `draw`) so the
  // light pass repaints without re-dithering the surface.
  const baseCanvas = document.createElement("canvas")
  baseCanvas.width = cols
  baseCanvas.height = rows
  const baseCtx = baseCanvas.getContext("2d")
  if (!baseCtx) return undefined

  // Bloom layer: a blurred, additive copy of the crisp canvas.
  const bloomCtx = bloomCanvas?.getContext("2d") ?? null
  if (bloomCanvas) {
    bloomCanvas.width = cols
    bloomCanvas.height = rows
  }

  const reduce = prefersReducedMotion()
  const EASE = reduce ? 1 : 0.18
  const animate = state.current.animate && !reduce
  const duration = state.current.animationDuration
  // Hover fade length. Reduced motion jumps straight to the target.
  const FADE = reduce ? 0 : 340
  const current: Record<string, Surface> = {}

  // Per-chart phase offset so neighbouring charts never sweep in lockstep.
  const phase = (() => {
    const key = state.current.configKeys[0]
    const fill = key ? state.current.seedOf(key).fill : [7, 11, 13]
    const v = fill[0] * 7 + fill[1] * 13 + fill[2] * 29
    return (v % 97) / 97
  })()

  // Calm mode's still highlight (fixed position, no motion).
  const STILL = { x: cols * 0.16, width: Math.max(22, cols * 0.34), peak: 0.06 }

  // `reveal` (0–1) sweeps the fill in left-to-right on first paint.
  const paintFill = (layer: number, reveal: number) => {
    const octx = liftCtx[layer]
    const weight = layer
    octx.clearRect(0, 0, cols, rows)
    const s = state.current
    const stacked = s.stackType === "stacked" || s.stackType === "percent"
    const revealCols = Math.ceil(reveal * cols)
    s.configKeys.forEach((key, si) => {
      const cur = current[key]
      if (!cur) return
      const seed = s.seedOf(key)
      const variant = s.seriesSpecs[key]?.variant ?? "gradient"
      const isLine =
        (s.seriesSpecs[key]?.kind ??
          (s.chartType === "line" ? "line" : "area")) === "line"
      const emphasis = s.selectedDataKey ?? s.focusDataKey
      const dim = emphasis !== null && emphasis !== key ? 0.3 : 1
      // Overlapping (non-stacked) layers thin out front-to-back so they
      // read as distinct layers instead of a muddy blend.
      const sparse = stacked ? 0 : si * 0.14
      for (let x = 0; x < cols; x++) {
        if (x > revealCols) break
        // For a value that dips below the zero baseline the value line ends up
        // *below* the floor in pixels; paintColumn needs the higher edge first,
        // so order the pair (a no-op for the common positive case).
        const a = cur.top[x] ?? 0
        const b = cur.floor[x] ?? 0
        paintColumn(octx, x, Math.min(a, b), Math.max(a, b), seed, {
          variant,
          intensity: weight,
          dim,
          stacked: stacked && !isLine,
          sparse,
        })
      }
    })
  }

  let animStart = 0
  let lastProg = -1
  let lastRevision = state.current.revision
  let entranceReported = !animate
  // Hover lift, faded between the two cached fill layers.
  let intensity = 0
  let liftTarget = 0
  let liftFrom = 0
  let liftStart = 0
  // Last blended value actually composited, so a change in lift always repaints
  // even when the fade is instant (reduced motion).
  let drawnIntensity = -1
  // Whether each cached layer matches the current surfaces / reveal / emphasis.
  const layerDirty = [true, true]
  let needsFill = true
  let baseDirty = true
  let bloomDirty = false
  let lastPaintSig = ""
  let lastSelected: string | null | undefined = Symbol() as never
  // The crosshair moves on almost every pointer event; tracking it separately
  // from the fill is what lets a hover redraw skip the dither repaint.
  let lastMarker: number | null | undefined = Symbol() as never
  let glowX = -1
  let glowY = -1

  // Compose the current lift blend into the reusable base buffer.
  const composeFill = () => {
    baseCtx.clearRect(0, 0, cols, rows)
    if (intensity <= 0) {
      baseCtx.drawImage(liftCanvas[0], 0, 0)
    } else if (intensity >= 1) {
      baseCtx.drawImage(liftCanvas[1], 0, 0)
    } else {
      // Additive cross-blend: both layers share the same colour per series, so
      // summing the premultiplied pixels gives an exact linear mix of the two
      // weights (a plain source-over blend would dim the middle of the fade).
      baseCtx.globalCompositeOperation = "lighter"
      baseCtx.globalAlpha = 1 - intensity
      baseCtx.drawImage(liftCanvas[0], 0, 0)
      baseCtx.globalAlpha = intensity
      baseCtx.drawImage(liftCanvas[1], 0, 0)
      baseCtx.globalAlpha = 1
      baseCtx.globalCompositeOperation = "source-over"
    }
  }

  const draw = (now: number, full: boolean) => {
    const s = state.current
    if (!s.ready) return
    if (full) needsFill = true
    const tgt = targets.current
    if (s.revision !== lastRevision) {
      lastRevision = s.revision
      animStart = 0 // re-play the entrance on data change / replay
      lastProg = -1
      entranceReported = false
    }
    if (!animStart) animStart = now
    const prog = animate ? Math.min(1, (now - animStart) / duration) : 1
    const progChanged = prog !== lastProg
    // Tell the context the reveal is done so DOM markers fade in in sync.
    if (prog >= 1 && !entranceReported) {
      entranceReported = true
      s.markEntranceDone()
    }

    let moving = false
    for (const key of s.configKeys) {
      const t = tgt[key]
      if (!t) continue
      const cur = current[key]
      if (!cur || cur.top.length !== cols) {
        current[key] = { top: t.top.slice(), floor: t.floor.slice() }
        needsFill = true
        continue
      }
      for (let x = 0; x < cols; x++) {
        const dt = t.top[x] - cur.top[x]
        const df = t.floor[x] - cur.floor[x]
        if (Math.abs(dt) > 0.01 || Math.abs(df) > 0.01) {
          cur.top[x] += dt * EASE
          cur.floor[x] += df * EASE
          moving = true
        } else {
          cur.top[x] = t.top[x]
          cur.floor[x] = t.floor[x]
        }
      }
    }
    for (const key of Object.keys(current)) {
      if (!tgt[key]) {
        delete current[key]
        needsFill = true
      }
    }
    if (moving) needsFill = true
    const emphasisNow = s.selectedDataKey ?? s.focusDataKey
    if (emphasisNow !== lastSelected) {
      lastSelected = emphasisNow
      needsFill = true
    }

    // Fade the lift toward its target instead of snapping. Both brightness
    // layers are cached, so a fade frame only re-blends two images — a full
    // dither repaint happens once per layer, not once per frame.
    const itTarget = s.isMouseInChart || s.hovered ? 1 : 0
    if (itTarget !== liftTarget) {
      liftFrom = intensity
      liftTarget = itTarget
      liftStart = now
    }
    const fade = FADE === 0 ? 1 : Math.min(1, (now - liftStart) / FADE)
    const settling = fade < 1
    intensity = liftFrom + (liftTarget - liftFrom) * easeInOutCubic(fade)

    // Live hover wins; the controlled markerIndex (e.g. a committed point)
    // is the fallback shown when nothing is hovered.
    const marker = s.hoverIndex != null ? s.hoverIndex : s.markerIndex
    const markerChanged = marker !== lastMarker
    if (markerChanged) lastMarker = marker
    // Repaint when a tweak-driven paint input changes (variant, stacking) so
    // the panel updates the fill live — without resetting the entrance reveal.
    const paintSig = `${s.stackType}|${s.configKeys
      .map((k) => s.seriesSpecs[k]?.variant ?? "")
      .join(",")}`
    const sigChanged = paintSig !== lastPaintSig
    if (sigChanged) {
      lastPaintSig = paintSig
      needsFill = true
    }

    // Idle lighting: a slow sweep while the chart is visible and untouched, at
    // the reduced cadence; a hovered chart drops back to every frame so the
    // glow tracks the cursor. Reduced motion / a low battery gets the static
    // lit look instead (painted with the fill, never animated).
    const calm = calmMotion()
    const hot = s.isMouseInChart || s.hovered
    scheduler?.setFrameInterval(hot ? HOVER_FRAME_MS : IDLE_FRAME_MS)

    const staticChanged =
      moving || settling || needsFill || progChanged || sigChanged || markerChanged
    if (!staticChanged && calm) return

    if (progChanged) {
      lastProg = prog
      needsFill = true
    }

    // Reveal front (left-to-right) — stars + crosshair stay behind it so
    // they don't float over the not-yet-drawn area during the entrance.
    const reveal = animate ? easeInOutCubic(prog) : 1
    const revealCols = reveal * cols

    if (needsFill) {
      layerDirty[0] = true
      layerDirty[1] = true
      needsFill = false
    }
    // Paint only the layers the current blend needs, and only when stale.
    const needBoth = intensity > 0 && intensity < 1
    let painted = false
    for (let layer = 0; layer < 2; layer++) {
      if (!layerDirty[layer]) continue
      if (!needBoth && layer !== (intensity >= 1 ? 1 : 0)) continue
      paintFill(layer, reveal)
      layerDirty[layer] = false
      painted = true
    }
    if (painted || intensity !== drawnIntensity) baseDirty = true

    const accent = (s.configKeys.length
      ? s.seedOf(s.configKeys[0])
      : s.seedOf("")
    ).line

    if (baseDirty) {
      composeFill()
      baseDirty = false
      drawnIntensity = intensity
      bloomDirty = true
    }

    // Restore the crisp fill before layering this frame's light and overlays.
    // `copy` replaces pixels *including* alpha, so nothing a previous frame
    // drew (sweep, glow, crosshair, glints) can accumulate — and a single blit
    // is cheaper than tracking every rect the previous frame touched.
    c.globalCompositeOperation = "copy"
    c.drawImage(baseCanvas, 0, 0)
    c.globalCompositeOperation = "source-over"

    // Calm mode keeps one soft, static highlight instead of the sweep.
    if (calm) paintSheen(c, STILL, rows, accent)

    const mx =
      marker != null && s.dataLength > 1
        ? Math.round((marker / (s.dataLength - 1)) * (cols - 1))
        : -1

    // ── Idle light: one soft band travelling across the fill ──────────────
    if (!calm) {
      const sheen = sheenAt(now, cols, phase)
      paintSheen(c, sheen, rows, accent)
      // Contour glint: where the band crosses, the value line lights up so the
      // silhouette reads as a neon edge rather than a flat stroke.
      const centre = sheen.x + sheen.width / 2
      const half = sheen.width / 2
      const from = Math.max(0, Math.floor(sheen.x))
      const to = Math.min(cols - 1, Math.ceil(sheen.x + sheen.width))
      const breathe = sheen.peak / SHEEN_PEAK
      for (const key of s.configKeys) {
        const cur = current[key]
        if (!cur) continue
        c.fillStyle = rgb(s.seedOf(key).line)
        for (let x = from; x <= to; x++) {
          const fall = 1 - Math.abs(x - centre) / half
          if (fall <= 0.05) continue
          const y = Math.round(cur.top[x] ?? 0)
          if (y < 0 || y >= rows) continue
          c.globalAlpha = 0.3 * fall * breathe
          c.fillRect(x, y, 1, 1)
        }
      }
      c.globalAlpha = 1
    }

    // ── Hover light: a soft radial glow riding the active point ───────────
    if (intensity > 0.01 && mx >= 0 && mx <= cols - 1) {
      // Ease the centre toward the new point; a fast scrub glides, a jump
      // between distant points does not teleport. Calm mode snaps instead.
      let targetY = rows * 0.5
      for (const key of s.configKeys) {
        const cur = current[key]
        if (cur) {
          targetY = cur.top[mx] ?? targetY
          break
        }
      }
      if (glowX < 0 || calm) {
        glowX = mx
        glowY = targetY
      } else {
        glowX += (mx - glowX) * 0.3
        glowY += (targetY - glowY) * 0.3
      }
      const radius = Math.max(14, rows * 0.3)
      paintGlow(c, glowX, glowY, radius, accent, 0.62 * intensity)
      // Brighten the contour immediately around the cursor as well.
      const spread = 9
      for (const key of s.configKeys) {
        const cur = current[key]
        if (!cur) continue
        c.fillStyle = rgb(s.seedOf(key).line)
        for (let x = Math.max(0, mx - spread); x <= Math.min(cols - 1, mx + spread); x++) {
          const y = Math.round(cur.top[x] ?? 0)
          if (y < 0 || y >= rows) continue
          c.globalAlpha = 0.55 * intensity * (1 - Math.abs(x - mx) / (spread + 1))
          c.fillRect(x, y, 1, 1)
        }
      }
      c.globalAlpha = 1
    } else {
      glowX = -1
    }

    if (mx >= 0 && mx <= revealCols) {
      for (const key of s.configKeys) {
        const cur = current[key]
        if (!cur) continue
        const seed = s.seedOf(key)
        const my = Math.round(cur.top[mx] ?? 0)
        // Full-height column + a chunky marker block at the point — the
        // series colour at higher opacity, so it reads on either theme.
        c.fillStyle = rgb(seed.fill, 1, 0.55)
        for (let y = my; y < rows; y++) c.fillRect(mx, y, 1, 1)
        c.fillStyle = rgb(seed.fill)
        c.fillRect(mx - 1, my - 1, 3, 3)
      }
    }

    for (const star of stars.current) {
      const cur = current[star.key]
      if (!cur) continue
      const sx = Math.round(
        (star.xi / Math.max(s.dataLength - 1, 1)) * (cols - 1)
      )
      if (sx > revealCols) continue // behind the reveal front
      const top = cur.top[sx] ?? 0
      const floor = cur.floor[sx] ?? rows - 1
      const sy = Math.round(top + star.depth * (floor - top))
      // Slow twinkle while the light is running; steady glints in calm mode.
      const tw = calm
        ? 0.85
        : (Math.sin(star.phase * 0.35 + now * 0.0012) + 1) / 2
      const lift = tw * (0.7 + 0.3 * intensity)
      if (lift < 0.55 || sy < 0 || sy >= rows) continue
      // Sparkles glint in the series colour via opacity
      // rather than a lighter shade — so they never read as stray white
      // pixels on a light background.
      c.fillStyle = rgb(s.seedOf(star.key).fill)
      c.globalAlpha = lift
      c.fillRect(sx, sy, 1, 1)
      // The brightest stars flare into a 4-point glint.
      if (tw > 0.9) {
        c.globalAlpha = lift * 0.6 * (tw - 0.9) * 10
        c.fillRect(sx - 1, sy, 1, 1)
        c.fillRect(sx + 1, sy, 1, 1)
        c.fillRect(sx, sy - 1, 1, 1)
        c.fillRect(sx, sy + 1, 1, 1)
      }
    }
    c.globalAlpha = 1

    if (bloomDirty) {
      bloomDirty = false
      if (bloomCtx) {
        bloomCtx.clearRect(0, 0, cols, rows)
        if (s.bloom !== "off") bloomCtx.drawImage(canvas, 0, 0)
      }
    }
    return moving || settling || prog < 1 || !calm
  }

  // Declared after `draw` for readability; the callback only runs from an
  // animation frame, so it is always initialized by the time `draw` reads it.
  const scheduler = scheduleCanvas(canvas, draw)
  return scheduler
}

/**
 * Continuous dither canvas for area and line charts. Each series is reduced to a
 * `[top, floor]` band per backing column: areas fill from their value line down
 * to their floor; lines fill only a thin glow band hugging the line. The shared
 * {@link paintColumn} renders the ordered-dither scatter, capped by the bright
 * series line, with static glints + scrub crosshair on top.
 */
export function CartesianCanvas() {
  const ctx = useChart()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bloomRef = useRef<HTMLCanvasElement>(null)

  const { width, height } = ctx.plot
  const { cols, rows } = backingSize(width, height)
  const { ready, chartType, configKeys, bands, seriesSpecs, y, dataLength } = ctx

  // Memoized: the pricey bit in the render path — a `resample` per series to
  // the backing column count. The canvas re-renders on every hover/cursor tick
  // (it consumes ctx), so without this the whole surface is rebuilt each time.
  // Pinned to the exact ctx fields it reads, plus the backing geometry.
  const targets = useMemo(() => {
    const out: Record<string, Surface> = {}
    if (!ready) return out
    const h = height || 1
    const glow = Math.max(6, Math.round(rows * 0.16))
    const defaultKind = chartType === "line" ? "line" : "area"
    for (const key of configKeys) {
      const band = bands[key]
      if (!band) continue
      const line = (seriesSpecs[key]?.kind ?? defaultKind) === "line"
      const top = band.map((b) => (y(b[1]) / h) * (rows - 1))
      const floor = band.map((b, i) =>
        line ? Math.min(rows - 1, top[i] + glow) : (y(b[0]) / h) * (rows - 1)
      )
      out[key] = { top: resample(top, cols), floor: resample(floor, cols) }
    }
    return out
  }, [ready, chartType, configKeys, bands, seriesSpecs, y, height, rows, cols])

  // Memoized: the star field is deterministic — only its shape (series ×
  // column count) matters, so it need not be rebuilt on unrelated re-renders.
  const stars = useMemo(() => {
    const out: Star[] = []
    const per = Math.max(4, Math.round(cols / 14))
    configKeys.forEach((key, k) => {
      for (let i = 0; i < per; i++) {
        const seed = i * 67 + 13 + k * 131
        out.push({
          key,
          xi: seed % Math.max(dataLength, 1),
          depth: ((seed * 53 + 7) % 100) / 100,
          phase: (seed * 41) % 360,
        })
      }
    })
    return out
  }, [configKeys, dataLength, cols])

  // The RAF loop reads these through refs so it always sees the latest values
  // without re-subscribing. Refs are written in an effect (never during
  // render) — mutating a ref mid-render is a React anti-pattern that tears
  // under Strict Mode / concurrent rendering.
  const stateRef = useRef(ctx)
  const targetsRef = useRef(targets)
  const starsRef = useRef(stars)
  const schedulerRef = useRef<CanvasScheduler | undefined>(undefined)
  // Geometry identity tells us whether the painted surface changed. Hover and
  // cursor ticks re-render this component too, and those must not force a dither
  // repaint — they only move the overlay.
  const fillInputsRef = useRef({ targets, stars })
  useEffect(() => {
    stateRef.current = ctx
    targetsRef.current = targets
    starsRef.current = stars
    const prev = fillInputsRef.current
    const full = prev.targets !== targets || prev.stars !== stars
    fillInputsRef.current = { targets, stars }
    schedulerRef.current?.invalidate(full)
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scheduler = startCartesianLoop({
      canvas,
      bloomCanvas: bloomRef.current,
      cols,
      rows,
      state: stateRef,
      targets: targetsRef,
      stars: starsRef,
    })
    schedulerRef.current = scheduler
    return () => { scheduler?.dispose(); schedulerRef.current = undefined }
  }, [cols, rows])

  // A reduced-motion / battery change switches the light between moving and
  // static; repaint once with the new mode rather than restarting the loop.
  useEffect(
    () => onMotionChange(() => schedulerRef.current?.invalidate(true)),
    []
  )

  const bloomActive = ctx.bloomOnHover
    ? ctx.isMouseInChart || ctx.hovered
    : true
  const bloom = bloomLayerStyle(ctx.bloom, bloomActive)
  const pos = {
    left: ctx.margins.left,
    top: ctx.margins.top,
    width,
    height,
  } as const

  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute"
        style={{ ...pos, imageRendering: "pixelated" }}
      />
      <canvas
        ref={bloomRef}
        className="pointer-events-none absolute"
        style={{
          ...pos,
          transition: "opacity 220ms ease",
          ...(bloom ?? { opacity: 0 }),
        }}
      />
    </>
  )
}
