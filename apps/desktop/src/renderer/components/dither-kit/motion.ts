// One source of truth for "may decoration move right now?".
//
// The answer is cached at module scope so a canvas can ask on every frame
// without touching `matchMedia`, and every canvas is told when it flips, so a
// chart can repaint once and then settle into its static lit look. Android
// keeps this static look to avoid continuous canvas rendering on the phone.
//
//   * `prefers-reduced-motion` — the OS accessibility switch.
//   * the Battery Status API — only a genuinely low, unplugged battery calms
//     the charts. Desktop Chromium reports a synthetic 1.0/charging battery,
//     so this is a no-op there; browsers without the API are skipped entirely.

type BatteryLike = {
  charging: boolean
  level: number
  addEventListener?: (type: string, fn: () => void) => void
}

let reduced = false
let lowPower = false
let mobile = false
let started = false
const listeners = new Set<() => void>()

function notify() {
  // Copy first: a listener may unsubscribe itself while we walk the set.
  for (const fn of [...listeners]) fn()
}

function start() {
  if (started || typeof window === "undefined") return
  started = true
  mobile = document.documentElement.dataset.platform === "android"
  if (mobile) return

  const media = window.matchMedia?.("(prefers-reduced-motion: reduce)")
  if (media) {
    reduced = media.matches
    media.addEventListener?.("change", (event) => {
      if (event.matches === reduced) return
      reduced = event.matches
      notify()
    })
  }

  const nav = navigator as Navigator & {
    getBattery?: () => Promise<BatteryLike>
  }
  // Best-effort only: a failed/absent promise must never disturb the charts.
  nav.getBattery?.()
    .then((battery) => {
      const update = () => {
        const next = !battery.charging && battery.level <= 0.2
        if (next === lowPower) return
        lowPower = next
        notify()
      }
      battery.addEventListener?.("levelchange", update)
      battery.addEventListener?.("chargingchange", update)
      update()
    })
    .catch(() => undefined)
}

/** True when decoration should hold still and the chart keeps a static glow. */
export function calmMotion(): boolean {
  start()
  return mobile || reduced || lowPower
}

/** Notifies once whenever {@link calmMotion} may have changed. */
export function onMotionChange(fn: () => void): () => void {
  start()
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
