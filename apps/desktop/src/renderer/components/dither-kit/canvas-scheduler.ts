export interface CanvasScheduler {
  invalidate(): void
  dispose(): void
}

/** Paint only while visible and dirty, or while an interaction is settling. */
export function scheduleCanvas(
  canvas: HTMLCanvasElement,
  draw: (now: number, dirty: boolean) => boolean | void,
): CanvasScheduler {
  let frame = 0
  let dirty = true
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
    const repaint = dirty
    dirty = false
    if (draw(now, repaint) || dirty) request()
  }
  const invalidate = () => { dirty = true; request() }
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
