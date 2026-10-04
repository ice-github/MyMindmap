// FLIP + appear animations isolated from mind-elixir data mutations.
import { getEdgeDrawOffset, getNodeEdges, getInputBox, getTopicElements, getTopicId } from './dom-adapter.js'

export type AnimationPrefs = {
  animationEnabled: boolean
  appearEffect: boolean
  edgeEffect: boolean
  dimExistingEdges: boolean
  flipEnabled: boolean
  focusPulse: boolean
}

const FLIP_DURATION = 400
const EDGE_RESTORE_DURATION = 150
const EDGE_DIM_OPACITY = 0.25
const APPEAR_DURATION = 550
const PULSE_DURATION = 600
const MAX_FLIP_TARGETS = 200
const STAGGER_MS = 70
const MAX_STAGGER = 10
const EDGE_DELAY = 100

function isVisible(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0
}

export class FlipAnimator {
  private prefs: AnimationPrefs = {
    animationEnabled: true,
    appearEffect: true,
    edgeEffect: true,
    dimExistingEdges: true,
    flipEnabled: true,
    focusPulse: true,
  }
  private running = new Set<Animation>()
  private cleanups = new Map<Animation, () => void>()
  private dimmedEdges = new Map<SVGPathElement, { animation: Animation; opacity: number }>()
  private reduceMotion = false
  private media: MediaQueryList | null = null
  private onMedia = (e: { matches: boolean }): void => {
    this.reduceMotion = e.matches
    if (e.matches) this.cancelAll()
  }

  constructor() {
    try {
      this.media = window.matchMedia('(prefers-reduced-motion: reduce)')
      this.reduceMotion = this.media.matches
      if (typeof this.media.addEventListener === 'function') {
        this.media.addEventListener('change', this.onMedia)
      }
    } catch {
      this.media = null
    }
  }

  setPrefs(p: AnimationPrefs): void {
    const effectDisabled = (this.prefs.edgeEffect && !p.edgeEffect) ||
      (this.prefs.dimExistingEdges && !p.dimExistingEdges) ||
      (this.prefs.appearEffect && !p.appearEffect) ||
      (this.prefs.flipEnabled && !p.flipEnabled) ||
      (this.prefs.focusPulse && !p.focusPulse)
    this.prefs = {
      animationEnabled: p.animationEnabled,
      appearEffect: p.appearEffect,
      edgeEffect: p.edgeEffect,
      dimExistingEdges: p.dimExistingEdges,
      flipEnabled: p.flipEnabled,
      focusPulse: p.focusPulse,
    }
    if (!this.shouldAnimate() || effectDisabled) this.cancelAll()
  }

  private shouldAnimate(): boolean {
    // Media-query change events can arrive after the next input event. Read
    // the live value too, so a newly enabled preference takes effect at once.
    return this.prefs.animationEnabled && !(this.media?.matches ?? this.reduceMotion)
  }

  capture(root: HTMLElement): Map<string, DOMRect> {
    const out = new Map<string, DOMRect>()
    for (const el of getTopicElements(root)) {
      const id = getTopicId(el)
      if (!id || out.has(id)) continue
      try {
        out.set(id, el.getBoundingClientRect())
      } catch {
        // ignore measurement errors
      }
    }
    return out
  }

  async playFlip(root: HTMLElement, before: Map<string, DOMRect>): Promise<void> {
    if (!this.shouldAnimate() || !this.prefs.flipEnabled || before.size === 0) return
    const jobs: Array<{ el: Element; dx: number; dy: number }> = []
    for (const el of getTopicElements(root)) {
      const id = getTopicId(el)
      if (!id) continue
      const prev = before.get(id)
      if (!prev) continue
      let next: DOMRect
      try {
        next = el.getBoundingClientRect()
      } catch {
        continue
      }
      if (!isVisible(next)) continue
      const dx = prev.left - next.left
      const dy = prev.top - next.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
      jobs.push({ el, dx, dy })
      if (jobs.length > MAX_FLIP_TARGETS) return
    }
    const movements: Animation[] = []
    for (const { el, dx, dy } of jobs) {
      try {
        const anim = el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: 'translate(0, 0)' },
          ],
          { duration: FLIP_DURATION, easing: 'cubic-bezier(.2,.7,.3,1)' },
        )
        this.track(anim)
        movements.push(anim)
      } catch {
        // animation is best-effort
      }
    }
    if (movements.length > 0 && this.prefs.dimExistingEdges) {
      this.dimEdgesDuringReflow(root, before)
    }
    await Promise.all(movements.map((anim) => anim.finished.catch(() => undefined)))
  }

  /** Dim only existing connectors while FLIP plays; no style/geometry mutation. */
  private dimEdgesDuringReflow(root: HTMLElement, before: Map<string, DOMRect>): void {
    const jobs: Array<{ path: SVGPathElement; opacity: number }> = []
    for (const [nodeId, path] of getNodeEdges(root)) {
      if (!before.has(nodeId)) continue
      const opacity = this.dimmedEdges.get(path)?.opacity ?? Number.parseFloat(getComputedStyle(path).opacity)
      if (Number.isFinite(opacity) && opacity > 0) jobs.push({ path, opacity })
    }
    const duration = FLIP_DURATION + EDGE_RESTORE_DURATION
    for (const { path, opacity } of jobs) {
      const previous = this.dimmedEdges.get(path)
      if (previous) this.cancelAnimation(previous.animation)
      try {
        const anim = path.animate(
          [
            { opacity: opacity * EDGE_DIM_OPACITY, offset: 0 },
            { opacity: opacity * EDGE_DIM_OPACITY, offset: FLIP_DURATION / duration, easing: 'ease-out' },
            { opacity, offset: 1 },
          ],
          { duration, easing: 'linear' },
        )
        this.dimmedEdges.set(path, { animation: anim, opacity })
        this.track(anim, () => {
          if (this.dimmedEdges.get(path)?.animation === anim) this.dimmedEdges.delete(path)
        })
      } catch {
        // No persistent opacity styles to restore when WAAPI is unavailable.
      }
    }
  }

  animateAppear(el: HTMLElement, delayMs = 0): void {
    if (!this.shouldAnimate() || !this.prefs.appearEffect) return
    this.appearOnly(el, delayMs, false)
  }

  /** Fade/slide/scale in elements that appeared since `before` was captured. */
  revealNew(root: HTMLElement, before: Map<string, DOMRect>): void {
    if (!this.shouldAnimate() || !this.prefs.appearEffect) return
    const fresh: HTMLElement[] = []
    for (const el of getTopicElements(root)) {
      const id = getTopicId(el)
      if (!id || before.has(id)) continue
      try {
        const rect = el.getBoundingClientRect()
        if (!isVisible(rect)) continue
      } catch {
        continue
      }
      fresh.push(el)
    }
    const pulseSingle = fresh.length === 1 && this.prefs.focusPulse
    fresh.forEach((el, i) => {
      this.appearOnly(el, Math.min(i, MAX_STAGGER) * STAGGER_MS, pulseSingle)
    })
    // New nodes usually open the inline edit box on top of them. Animate it
    // together so the effect stays visible instead of hiding behind the box.
    const box = getInputBox(root)
    if (box && fresh.length > 0) {
      this.appearOnly(box, 0, false)
    }
  }

  private appearOnly(el: HTMLElement, delayMs: number, chainPulse: boolean): void {
    try {
      const anim = el.animate(
        [
          { opacity: '0', transform: 'translateY(14px) scale(0.78)' },
          // 中間キーを置き、変化を再生時間全体に分散させる。
          { opacity: '0.6', transform: 'translateY(6px) scale(0.9)', offset: 0.55 },
          { opacity: '1', transform: 'translateY(0) scale(1)' },
        ],
        { duration: APPEAR_DURATION, easing: 'cubic-bezier(.4,0,.2,1)', delay: delayMs, fill: 'backwards' },
      )
      this.track(anim)
      if (chainPulse) this.chainPulse(el, anim)
    } catch {
      // animation is best-effort
    }
  }

  private chainPulse(el: HTMLElement, after: Animation): void {
    if (!this.prefs.focusPulse) return
    try {
      const done = after.finished
      if (!done || typeof done.then !== 'function') return
      void done.then(
        () => {
          if (this.shouldAnimate() && this.prefs.focusPulse) this.pulse(el)
        },
        () => undefined,
      )
    } catch {
      // best-effort
    }
  }

  pulse(el: HTMLElement): void {
    if (!this.shouldAnimate() || !this.prefs.focusPulse) return
    try {
      const anim = el.animate(
        [
          { opacity: '0.25', transform: 'scale(0.88)' },
          { opacity: '1', transform: 'scale(1)' },
        ],
        { duration: PULSE_DURATION, easing: 'ease-out' },
      )
      this.track(anim)
    } catch {
      // best-effort
    }
  }

  /** Child ids keep existing edges identifiable even when SVGs are rebuilt. */
  captureEdges(root: HTMLElement): Set<string> {
    return new Set(getNodeEdges(root).keys())
  }

  /** Line-drawing reveal for edges that appeared since `before` was captured. */
  revealNewEdges(root: HTMLElement, before: Set<string>): void {
    if (!this.shouldAnimate() || !this.prefs.edgeEffect) return
    let index = 0
    for (const [nodeId, path] of getNodeEdges(root)) {
      if (before.has(nodeId)) continue
      const delay = this.prefs.appearEffect ? EDGE_DELAY + Math.min(index, MAX_STAGGER) * STAGGER_MS : 0
      this.drawEdge(root, nodeId, path, delay)
      index++
    }
  }

  private drawEdge(root: HTMLElement, nodeId: string, path: SVGPathElement, delay: number): void {
    let len: number
    try {
      if (typeof path.getTotalLength !== 'function') return
      len = path.getTotalLength()
    } catch {
      return
    }
    if (!Number.isFinite(len) || len <= 0) return
    const offset = getEdgeDrawOffset(root, nodeId, path, len)
    const style = path.style
    const prevDash = style.getPropertyValue('stroke-dasharray')
    const prevOffset = style.getPropertyValue('stroke-dashoffset')
    const dashPriority = style.getPropertyPriority('stroke-dasharray')
    const offsetPriority = style.getPropertyPriority('stroke-dashoffset')
    const cleanup = (): void => {
      if (prevDash !== '') style.setProperty('stroke-dasharray', prevDash, dashPriority)
      else style.removeProperty('stroke-dasharray')
      if (prevOffset !== '') style.setProperty('stroke-dashoffset', prevOffset, offsetPriority)
      else style.removeProperty('stroke-dashoffset')
    }
    try {
      style.strokeDasharray = `${len}`
      style.strokeDashoffset = `${offset}`
      const anim = path.animate(
        [{ strokeDashoffset: `${offset}`, opacity: 0 }, { strokeDashoffset: '0', opacity: 1 }],
        { duration: APPEAR_DURATION, delay, fill: 'backwards', easing: 'cubic-bezier(.4,0,.2,1)' },
      )
      this.track(anim, cleanup)
    } catch {
      cleanup()
    }
  }

  cancelAll(): void {
    for (const anim of this.running) this.cancelAnimation(anim)
  }

  private cancelAnimation(anim: Animation): void {
    try {
      anim.cancel()
    } catch {
      // A detached or unsupported animation must not prevent other cleanup.
    } finally {
      this.running.delete(anim)
      this.cleanups.get(anim)?.()
      this.cleanups.delete(anim)
    }
  }

  dispose(): void {
    this.cancelAll()
    try {
      this.media?.removeEventListener('change', this.onMedia)
    } catch {
      // ignore
    }
    this.media = null
  }

  private track(anim: Animation, cleanup?: () => void): void {
    this.running.add(anim)
    if (cleanup) this.cleanups.set(anim, cleanup)
    const done = (): void => {
      this.running.delete(anim)
      this.cleanups.get(anim)?.()
      this.cleanups.delete(anim)
    }
    try {
      anim.finished.then(done, done)
    } catch {
      // older impl without finished promise
    }
  }
}
