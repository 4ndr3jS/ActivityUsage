"use client"

import { useEffect, useMemo, useRef } from "react"
import { useChart } from "./chart-context"
import { scheduleCanvas, type CanvasScheduler } from "./canvas-scheduler"
import {
  backingSize,
  bloomLayerStyle,
  clamp01,
  easeOutCubic,
  HOVER_FRAME_MS,
  IDLE_FRAME_MS,
  paintColumn,
  paintGlow,
  paintSheen,
  prefersReducedMotion,
  sheenAt,
} from "./dither-paint"
import { calmMotion, onMotionChange } from "./motion"
import { rgb } from "./palette"

type Bars = { top: number[]; base: number[] } // per data index, in backing rows

// Fraction of the timeline spent staggering bar starts — the rest is each bar's
// own grow window, so the rise sweeps across the chart as a wave.
const STAGGER = 0.55

/**
 * Dither canvas for bar charts. Each category owns a band; grouped series split
 * it into side-by-side bars, stacked series share its full width and pile in y.
 * Every bar is filled with the shared {@link paintColumn} ordered dither. Bars
 * grow up from their base in a staggered left-to-right wave (eased), the
 * hovered category lifts while the rest dim, and an idle light band travels
 * across the fill (restored from a cached base, never re-dithered).
 */
export function BarCanvas() {
  const ctx = useChart()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bloomRef = useRef<HTMLCanvasElement>(null)

  const { width, height } = ctx.plot
  const { cols, rows } = backingSize(width, height)
  const { ready, configKeys, bands, y } = ctx

  // Memoized: per-series bar tops/bases (backing rows) over the data indices.
  // The canvas re-renders on every hover/cursor tick, so pin this map to the
  // exact ctx fields it reads plus the backing geometry — a bar hover must not
  // rebuild every band's geometry.
  const targets = useMemo(() => {
    const out: Record<string, Bars> = {}
    if (!ready) return out
    const h = height || 1
    for (const key of configKeys) {
      const band = bands[key]
      if (!band) continue
      out[key] = {
        top: band.map((b) => (y(b[1]) / h) * (rows - 1)),
        base: band.map((b) => (y(b[0]) / h) * (rows - 1)),
      }
    }
    return out
  }, [ready, configKeys, bands, y, height, rows])

  // The RAF loop reads these through refs so it always sees the latest values;
  // refs are written in an effect (never during render) — mutating a ref
  // mid-render tears under Strict Mode / concurrent rendering.
  const state = useRef(ctx)
  const targetsRef = useRef(targets)
  const schedulerRef = useRef<CanvasScheduler | undefined>(undefined)
  useEffect(() => {
    state.current = ctx
    targetsRef.current = targets
    schedulerRef.current?.invalidate()
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const c = canvas?.getContext("2d")
    if (!(canvas && c) || cols <= 0 || rows <= 0) return
    canvas.width = cols
    canvas.height = rows

    // The crisp fill without pointer overlays — the light pass restores from it
    // so an idle frame copies pixels instead of re-dithering every bar.
    const baseCanvas = document.createElement("canvas")
    baseCanvas.width = cols
    baseCanvas.height = rows
    const baseCtx = baseCanvas.getContext("2d")
    if (!baseCtx) return

    const bloomCanvas = bloomRef.current
    const bloomCtx = bloomCanvas?.getContext("2d") ?? null
    if (bloomCanvas) {
      bloomCanvas.width = cols
      bloomCanvas.height = rows
    }

    const reduce = prefersReducedMotion()
    const animate = state.current.animate && !reduce
    const duration = state.current.animationDuration
    const fx = cols / Math.max(width, 1)

    // Per-chart offset so charts never sweep in lockstep.
    const firstKey = state.current.configKeys[0]
    const phaseSeed = firstKey
      ? state.current.seedOf(firstKey).fill
      : ([7, 11, 13] as const)
    const phase = ((phaseSeed[0] * 7 + phaseSeed[1] * 13 + phaseSeed[2] * 29) % 97) / 97
    const STILL = { x: cols * 0.16, width: Math.max(22, cols * 0.34), peak: 0.06 }

    // Eased grow factor for bar `i` at global progress `prog`.
    const barProgress = (i: number, len: number, prog: number) => {
      if (!animate) return 1
      const start = len > 1 ? (i / (len - 1)) * STAGGER : 0
      return easeOutCubic(clamp01((prog - start) / (1 - STAGGER)))
    }

    const paint = (prog: number) => {
      const s = state.current
      baseCtx.clearRect(0, 0, cols, rows)
      const stacked = s.stackType === "stacked" || s.stackType === "percent"
      const keys = s.configKeys
      keys.forEach((key, si) => {
        const t = targetsRef.current[key]
        if (!t) return
        const seed = s.seedOf(key)
        const variant = s.seriesSpecs[key]?.variant ?? "gradient"
        const emphasis = s.selectedDataKey ?? s.focusDataKey
        const selDim = emphasis !== null && emphasis !== key ? 0.3 : 1
        for (let i = 0; i < s.dataLength; i++) {
          const bp = barProgress(i, s.dataLength, prog)
          const base = t.base[i] ?? rows - 1
          const grown = base + ((t.top[i] ?? base) - base) * bp
          // Bars grow from the zero baseline toward the value. Positive values
          // sit above the baseline (smaller pixel), negative ones below it —
          // paintColumn wants the higher edge first, so order the pair.
          const top = Math.min(grown, base)
          const bottom = Math.max(grown, base)
          const active = s.hoverIndex === i
          const hoverDim =
            s.hoverIndex != null && !active && s.isMouseInChart ? 0.5 : 1
          const slot = s.barSlot(i, si, keys.length)
          const c0 = Math.round(slot.x * fx)
          const c1 = Math.round((slot.x + slot.width) * fx)
          for (let x = c0; x < c1; x++) {
            paintColumn(baseCtx, x, top, bottom, seed, {
              variant,
              intensity: intensity + (active ? 0.4 : 0),
              dim: selDim * hoverDim,
              stacked,
            })
          }
        }
      })
    }

    let animStart = 0
    let lastProg = -1
    let lastRevision = state.current.revision
    let intensity = 0
    let needsFill = true
    let lastPaintSig = ""
    let lastSelected: string | null | undefined = Symbol() as never
    let lastHover: number | null | undefined = Symbol() as never
    let glowX = -1
    let glowY = -1

    const draw = (now: number, full: boolean) => {
      const s = state.current
      if (!s.ready) return
      if (full) needsFill = true
      if (s.revision !== lastRevision) {
        lastRevision = s.revision
        animStart = 0 // re-play the wave on data change / replay
        lastProg = -1
      }
      if (!animStart) animStart = now
      const prog = animate ? Math.min(1, (now - animStart) / duration) : 1

      if (prog !== lastProg) {
        lastProg = prog
        needsFill = true
      }
      const emphasisNow = s.selectedDataKey ?? s.focusDataKey
      if (emphasisNow !== lastSelected) {
        lastSelected = emphasisNow
        needsFill = true
      }
      if (s.hoverIndex !== lastHover) {
        lastHover = s.hoverIndex
        needsFill = true
      }
      const itTarget = s.isMouseInChart || s.hovered ? 1 : 0
      if (Math.abs(intensity - itTarget) > 0.001) {
        intensity += (itTarget - intensity) * (reduce ? 1 : 0.16)
        needsFill = true
      } else intensity = itTarget

      // Live tweak repaint (variant, stacking) without replaying the wave.
      const paintSig = `${s.stackType}|${s.configKeys
        .map((k) => s.seriesSpecs[k]?.variant ?? "")
        .join(",")}`
      if (paintSig !== lastPaintSig) {
        lastPaintSig = paintSig
        needsFill = true
      }

      const calm = calmMotion()
      const hot = s.isMouseInChart || s.hovered
      scheduler?.setFrameInterval(hot ? HOVER_FRAME_MS : IDLE_FRAME_MS)
      if (!needsFill && calm) return

      const accent = (s.configKeys.length
        ? s.seedOf(s.configKeys[0])
        : s.seedOf("")
      ).line

      if (needsFill) {
        paint(prog)
        needsFill = false
        // Bloom tracks the fill only; a light-only frame must not pay for
        // another full canvas copy (and the blur texture upload it causes).
        if (bloomCtx) {
          bloomCtx.clearRect(0, 0, cols, rows)
          if (s.bloom !== "off") bloomCtx.drawImage(baseCanvas, 0, 0)
        }
      }

      // Restore the crisp fill (replacing pixels including alpha) so a
      // light-only frame can never accumulate over the previous one.
      c.globalCompositeOperation = "copy"
      c.drawImage(baseCanvas, 0, 0)
      c.globalCompositeOperation = "source-over"

      if (calm) paintSheen(c, STILL, rows, accent)
      else paintSheen(c, sheenAt(now, cols, phase), rows, accent)

      // Localized glow over the hovered category's tallest bar.
      if (intensity > 0.01 && s.hoverIndex != null) {
        const i = s.hoverIndex
        const t = targetsRef.current[s.configKeys[0]]
        const slot = s.barSlot(i, 0, s.configKeys.length)
        const tx = (slot.x + slot.width / 2) * fx
        const ty = t ? (t.top[i] ?? rows * 0.5) : rows * 0.5
        if (glowX < 0 || calm) {
          glowX = tx
          glowY = ty
        } else {
          glowX += (tx - glowX) * 0.3
          glowY += (ty - glowY) * 0.3
        }
        const radius = Math.max(14, rows * 0.3)
        paintGlow(c, glowX, glowY, radius, accent, 0.62 * intensity)
        // The hovered bar's cap reads as a lit edge.
        if (t) {
          const c0 = Math.round(slot.x * fx)
          const c1 = Math.round((slot.x + slot.width) * fx)
          c.fillStyle = rgb(s.seedOf(s.configKeys[0]).line)
          for (let x = c0; x < c1; x++) {
            const y = Math.round(t.top[i] ?? 0)
            if (y < 0 || y >= rows) continue
            c.globalAlpha = 0.5 * intensity
            c.fillRect(x, y, 1, 1)
          }
          c.globalAlpha = 1
        }
      } else {
        glowX = -1
      }

      return prog < 1 || Math.abs(intensity - itTarget) > 0.001 || !calm
    }

    // Declared after `draw` for readability; the callback only runs from an
    // animation frame, so it is always initialized by the time `draw` reads it.
    const scheduler = scheduleCanvas(canvas, draw)
    schedulerRef.current = scheduler
    return () => { scheduler?.dispose(); schedulerRef.current = undefined }
  }, [cols, rows, width])

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
