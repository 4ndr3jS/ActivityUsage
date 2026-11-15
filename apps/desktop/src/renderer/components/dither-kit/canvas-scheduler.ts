export interface CanvasScheduler {
  /**
   * Ask for a repaint. `full` means the painted surface itself changed (data,
   * geometry, series) so the expensive fill must be rebuilt. `false` means only
   * an overlay changed (crosshair, hover highlight) and the cached fill can be
   * blitted — which keeps pointer movement off the dither hot path.
   */
  invalidate(full?: boolean): void
  /**
   * Minimum time between draws while an animation is running, in ms. `0` (the
   * default) takes every frame. An idle chart sets this to a reduced cadence so
   * a slow decorative effect costs a fraction of a 60fps loop; an interaction
   * resets it to `0` and invalidates to paint on the next frame.
   */
  setFrameInterval(ms: number): void
  dispose(): void
}

/** Paint only while visible and dirty, or while an animation is settling. */
export function scheduleCanvas(
  canvas: HTMLCanvasElement,
  draw: (now: number, full: boolean) => boolean | void,
): CanvasScheduler {
  let frame = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = true
  let fullPaint = true
  let visible = false
  let disposed = false
  let interval = 0
  let lastPaint = Number.NEGATIVE_INFINITY

  const clearTimer = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }
  const request = () => {
    if (disposed || !visible || document.hidden || frame) return
    clearTimer()
    frame = requestAnimationFrame(paint)
  }
  const paint = (now: number) => {
    frame = 0
    if (disposed || !visible || document.hidden) return
    // Throttled cadence. Sleep out the remainder rather than re-arming a frame
    // callback: on a 144/180Hz display that would wake the main thread dozens of
    // times a second purely to skip the frame.
    const wait = interval - (now - lastPaint)
    if (wait > 0) {
      clearTimer()
      timer = setTimeout(() => {
        timer = undefined
        request()
      }, wait)
      return
    }
    lastPaint = now
    const full = fullPaint
    fullPaint = false
    dirty = false
    if (!draw(now, full) && !dirty) return
    // A throttled animation sleeps until its next paint is due; only an
    // unthrottled one asks for the very next frame.
    if (interval > 0) timer = setTimeout(request, interval)
    else request()
  }
  const invalidate = (full = true) => {
    dirty = true
    fullPaint = fullPaint || full
    // A caller asking for a repaint (hover, data change) must not wait out the
    // idle interval — it is the one signal that the user is looking right now.
    lastPaint = Number.NEGATIVE_INFINITY
    request()
  }
  const cancel = () => {
    cancelAnimationFrame(frame)
    frame = 0
    clearTimer()
  }
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
    setFrameInterval(ms: number) {
      interval = Math.max(0, ms)
    },
    dispose() {
      disposed = true
      cancel()
      observer.disconnect()
      document.removeEventListener("visibilitychange", visibilityChanged)
    },
  }
}
