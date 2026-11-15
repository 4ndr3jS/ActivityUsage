"use client"

import { useEffect, useRef } from "react"
import {
  BAYER,
  backingSize,
  bloomLayerStyle,
  easeInOutCubic,
  HOVER_FRAME_MS,
  IDLE_FRAME_MS,
  OFF_TIER,
  paintSheen,
  prefersReducedMotion,
  sheenAt,
} from "./dither-paint"
import { calmMotion, onMotionChange } from "./motion"
import { rgb } from "./palette"
import { distToPolygonEdge, pointInPolygon, polarX, polarY } from "./polar"
import { usePolarChart } from "./polar-context"
import { scheduleCanvas, type CanvasScheduler } from "./canvas-scheduler"

/**
 * Dither canvas for radar charts. Each series is a closed polygon over the
 * spokes with an ordered-dither fill and bright vertex markers. Painting is
 * driven by the shared scheduler, so an idle radar runs a single light band at
 * the reduced cadence instead of a permanent full-rate repaint.
 */
export function RadarCanvas() {
  const ctx = usePolarChart()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bloomRef = useRef<HTMLCanvasElement>(null)

  const { width, height } = ctx.plot
  const { cols, rows } = backingSize(width, height)
  const state = useRef(ctx)
  const schedulerRef = useRef<CanvasScheduler | undefined>(undefined)
  useEffect(() => {
    state.current = ctx
    schedulerRef.current?.invalidate()
  })

  useEffect(() => {
    const canvas = canvasRef.current
    const c = canvas?.getContext("2d")
    if (!(canvas && c) || cols <= 0 || rows <= 0) return
    canvas.width = cols
    canvas.height = rows

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
    let animStart = 0
    let lastProg = -1
    let lastRevision = state.current.revision
    let intensity = 0
    let needsFill = true
    let lastPaintSig = ""
    let lastSelected: string | null | undefined = Symbol() as never
    let lastHover: number | null | undefined = Symbol() as never

    const phaseSeed = state.current.configKeys[0]
      ? state.current.seedOf(state.current.configKeys[0]).fill
      : ([7, 11, 13] as const)
    const phase = ((phaseSeed[0] * 7 + phaseSeed[1] * 13 + phaseSeed[2] * 29) % 97) / 97
    const STILL = { x: cols * 0.16, width: Math.max(22, cols * 0.34), peak: 0.06 }

    const xFactor = cols / Math.max(width, 1)
    const yFactor = rows / Math.max(height, 1)

    const buildPolygons = (progress: number) => {
      const current = state.current
      const radar = current.radar
      if (!radar) return []
      return current.configKeys.map((key) => {
        const polygon: number[] = []
        const points: { x: number; y: number }[] = []
        radar.axes.forEach((axis, index) => {
          const value = Number(current.data[index]?.[key]) || 0
          const radius =
            (value / radar.max) * current.outerRadius * progress
          const x = polarX(current.center.x, radius, axis.angle)
          const y = polarY(current.center.y, radius, axis.angle)
          polygon.push(x, y)
          points.push({ x, y })
        })
        return { key, polygon, points }
      })
    }

    const paint = (progress: number) => {
      const current = state.current
      if (!current.radar) return
      baseCtx.clearRect(0, 0, cols, rows)
      const polygons = buildPolygons(easeInOutCubic(progress))
      const band = Math.max(current.outerRadius * 0.45, 1)

      for (let y = 0; y < rows; y++) {
        const plotY = ((y + 0.5) * height) / rows
        for (let x = 0; x < cols; x++) {
          const plotX = ((x + 0.5) * width) / cols
          let covered = false
          for (
            let polygonIndex = 0;
            polygonIndex < polygons.length;
            polygonIndex++
          ) {
            const { key, polygon } = polygons[polygonIndex]
            if (!pointInPolygon(plotX, plotY, polygon)) continue
            const seed = current.seedOf(key)
            const variant = current.variantOf(key)
            const emphasis =
              current.selectedDataKey ?? current.focusDataKey
            const selectionDim =
              emphasis !== null && emphasis !== key ? 0.3 : 1
            const distance = distToPolygonEdge(plotX, plotY, polygon)
            if (distance < 1.4) {
              baseCtx.fillStyle = rgb(seed.fill, 1, selectionDim)
              baseCtx.fillRect(x, y, 1, 1)
              covered = true
              continue
            }
            const density = 1 - Math.min(1, distance / band)
            const bias = variant === "dotted" ? 0.12 : 0
            const sparse = polygonIndex * 0.2
            if (variant === "hatched" && ((x + y) & 3) >= 2) continue
            const lit =
              variant === "solid" ||
              density >
                BAYER[y & 3][x & 3] - 0.1 * intensity - bias + sparse
            if (!lit && (variant === "dotted" || covered)) continue
            const opacity = (0.32 + density * 0.68) * (1 + 0.22 * intensity)
            const alpha = Math.min(
              1,
              (lit ? opacity : opacity * OFF_TIER) * selectionDim
            )
            baseCtx.fillStyle = rgb(seed.fill, 1, alpha)
            baseCtx.fillRect(x, y, 1, 1)
            covered = true
          }
        }
      }

      for (const { key, points } of polygons) {
        const seed = current.seedOf(key)
        const emphasis = current.selectedDataKey ?? current.focusDataKey
        const selectionDim =
          emphasis !== null && emphasis !== key ? 0.3 : 1
        points.forEach((point, index) => {
          const x = Math.round(point.x * xFactor)
          const y = Math.round(point.y * yFactor)
          const size = current.hoverIndex === index ? 2 : 1
          baseCtx.fillStyle = rgb(seed.fill, 1, selectionDim)
          baseCtx.fillRect(
            x - (size - 1),
            y - (size - 1),
            size * 2 - 1,
            size * 2 - 1
          )
        })
      }
    }

    const draw = (now: number) => {
      const current = state.current
      if (!current.ready || !current.radar) return
      if (current.revision !== lastRevision) {
        lastRevision = current.revision
        animStart = 0
        lastProg = -1
      }
      if (!animStart) animStart = now
      const progress = animate
        ? Math.min(1, (now - animStart) / duration)
        : 1

      const emphasisNow =
        current.selectedDataKey ?? current.focusDataKey
      if (emphasisNow !== lastSelected) {
        lastSelected = emphasisNow
        needsFill = true
      }
      if (current.hoverIndex !== lastHover) {
        lastHover = current.hoverIndex
        needsFill = true
      }
      const intensityTarget = current.isMouseInChart ? 1 : 0
      if (Math.abs(intensity - intensityTarget) > 0.001) {
        intensity +=
          (intensityTarget - intensity) * (reduce ? 1 : 0.16)
        needsFill = true
      } else intensity = intensityTarget
      if (progress !== lastProg) {
        lastProg = progress
        needsFill = true
      }

      const paintSig = current.configKeys
        .map((key) => current.variantOf(key))
        .join(",")
      if (paintSig !== lastPaintSig) {
        lastPaintSig = paintSig
        needsFill = true
      }

      const calm = calmMotion()
      scheduler?.setFrameInterval(
        current.isMouseInChart ? HOVER_FRAME_MS : IDLE_FRAME_MS
      )
      if (!needsFill && calm) return

      const accent = (current.configKeys.length
        ? current.seedOf(current.configKeys[0])
        : current.seedOf("")
      ).line

      if (needsFill) {
        paint(progress)
        needsFill = false
        if (bloomCtx) {
          bloomCtx.clearRect(0, 0, cols, rows)
          const on =
            current.bloom !== "off" &&
            (!current.bloomOnHover || current.isMouseInChart)
          if (on) bloomCtx.drawImage(baseCanvas, 0, 0)
        }
      }

      // Restore the crisp fill (replacing pixels including alpha) so a
      // light-only frame can never accumulate over the previous one.
      c.globalCompositeOperation = "copy"
      c.drawImage(baseCanvas, 0, 0)
      c.globalCompositeOperation = "source-over"

      if (calm) paintSheen(c, STILL, rows, accent)
      else paintSheen(c, sheenAt(now, cols, phase), rows, accent)

      return progress < 1 || Math.abs(intensity - intensityTarget) > 0.001 || !calm
    }

    // Declared after `draw` for readability; the callback only runs from an
    // animation frame, so it is always initialized by the time `draw` reads it.
    const scheduler = scheduleCanvas(canvas, draw)
    schedulerRef.current = scheduler
    return () => { scheduler?.dispose(); schedulerRef.current = undefined }
  }, [cols, rows, width, height])

  useEffect(
    () => onMotionChange(() => schedulerRef.current?.invalidate(true)),
    []
  )

  const bloom = bloomLayerStyle(
    ctx.bloom,
    ctx.bloomOnHover ? ctx.isMouseInChart : true
  )
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
