export interface CanvasScheduler {
  /**
   * Ask for a repaint. `full` means the painted surface itself changed (data,
   * geometry, series) so the expensive fill must be rebuilt. `false` means only
   * an overlay changed (crosshair, hover highlight) and the cached fill can be
   * blitted — which keeps pointer movement off the dither hot path.
   */
  invalidate(full?: boolean): void
  dispose(): void
}

/** Paint only while visible and dirty, or while an interaction is settling. */
export function scheduleCanvas(
  canvas: HTMLCanvasElement,
  draw: (now: number, full: boolean) => boolean | void,
): CanvasScheduler {
  let frame = 0
  let dirty = true
  let fullPaint = true
  let visible = false
  let disposed = false
  const request = () => {
    if (!disposed && visible && !document.hidden && !frame) {
      frame = requestAnimationFrame(paint)
    }
  }
  const paint = (now: number) => {
    frame = 0
    if (disposed || !visible || document.hidden) return
    const full = fullPaint
    fullPaint = false
    dirty = false
    if (draw(now, full) || dirty) request()
  }
  const invalidate = (full = true) => {
    dirty = true
    fullPaint = fullPaint || full
    request()
  }
  const cancel = () => { cancelAnimationFrame(frame); frame = 0 }
  const visibilityChanged = () => {
    if (document.hidden) cancel()
    else invalidate()
  }
  const observer = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting)
    if (visible) invalidate()
    else cancel()
  })
  observer.observe(canvas)
  document.addEventListener("visibilitychange", visibilityChanged)
  return {
    invalidate,
    dispose() {
      disposed = true
      cancel()
      observer.disconnect()
      document.removeEventListener("visibilitychange", visibilityChanged)
    },
  }
}
