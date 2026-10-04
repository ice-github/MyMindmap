// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FlipAnimator } from '../../src/mindmap/animations'

function rectOf(left: number, top: number, width = 100, height = 30): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect
}

function stubRect(el: Element, rect: DOMRect): void {
  el.getBoundingClientRect = () => rect
}

function makeRoot(): HTMLElement {
  const root = document.createElement('div')
  document.body.appendChild(root)
  return root
}

function makeTopic(root: HTMLElement, id: string, rect: DOMRect): HTMLElement {
  const el = document.createElement('div')
  el.className = 'topic'
  el.setAttribute('data-nodeid', id)
  stubRect(el, rect)
  root.appendChild(el)
  return el
}

type AnimateCall = { target: Element; keyframes: Keyframe[]; options?: KeyframeAnimationOptions }

function makeEdge(root: HTMLElement, d: string | null, len: number, id = `node-${len}`): SVGPathElement {
  let svg = root.querySelector('svg.lines');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'lines');
    root.appendChild(svg);
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
  if (d !== null) path.setAttribute('d', d);
  ;(path as unknown as { getTotalLength: () => number }).getTotalLength = () => len;
  svg.appendChild(path);
  let main = root.querySelector('me-main');
  if (!main) {
    main = document.createElement('me-main');
    root.appendChild(main);
  }
  const wrapper = document.createElement('me-wrapper');
  const parent = document.createElement('me-parent');
  const topic = document.createElement('me-tpc');
  topic.setAttribute('data-nodeid', `me${id}`);
  parent.appendChild(topic);
  wrapper.appendChild(parent);
  main.appendChild(wrapper);
  return path;
}
type FakeAnim = Animation & { __cancel: () => void }

function installAnimateMock(calls: AnimateCall[], onCancel?: () => void) {
  const fn = vi.fn(function (this: Element, keyframes: Keyframe[], options?: KeyframeAnimationOptions) {
    calls.push({ target: this, keyframes, options })
    const anim = {
      finished: Promise.resolve(),
      cancel: vi.fn(() => {
        onCancel?.()
      }),
    } as unknown as FakeAnim
    return anim as unknown as Animation
  })
  // jsdom may not implement Element.prototype.animate
  Object.defineProperty(Element.prototype, 'animate', {
    value: fn,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    value: fn,
    writable: true,
    configurable: true,
  })
  return fn
}

function allPrefs(on: boolean) {
  return { animationEnabled: on, appearEffect: on, edgeEffect: on, dimExistingEdges: on, flipEnabled: on, focusPulse: on }
}

beforeEach(() => {
  document.body.innerHTML = ''
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('FlipAnimator', () => {
  it('animates from old position back to identity', async () => {
    const animator = new FlipAnimator()
    animator.setPrefs(allPrefs(true))
    const root = makeRoot()
    const a = makeTopic(root, 'a', rectOf(0, 0))
    makeTopic(root, 'b', rectOf(0, 40))

    const before = animator.capture(root)
    expect(before.size).toBe(2)

    // Move a by (+10, +20); b stays.
    stubRect(a, rectOf(10, 20))

    const calls: AnimateCall[] = []
    const animateFn = installAnimateMock(calls)
    await animator.playFlip(root, before)

    expect(animateFn).toHaveBeenCalledTimes(1)
    const first = calls[0]?.keyframes[0] as Record<string, unknown>
    const last = calls[0]?.keyframes[1] as Record<string, unknown>
    expect(first['transform']).toBe('translate(-10px, -20px)')
    expect(last['transform']).toBe('translate(0, 0)')
    animator.dispose()
  })

  it('skips sub-pixel moves and invisible elements', async () => {
    const animator = new FlipAnimator()
    animator.setPrefs(allPrefs(true))
    const root = makeRoot()
    makeTopic(root, 'a', rectOf(0, 0))
    makeTopic(root, 'b', rectOf(0, 40))
    const before = animator.capture(root)

    // Sub-pixel shift for a: find element and re-stub.
    const els = root.querySelectorAll('.topic')
    stubRect(els[0] as HTMLElement, rectOf(0.5, 0.5))
    // Invisible (zero size) for b.
    stubRect(els[1] as HTMLElement, rectOf(50, 50, 0, 0))

    const calls: AnimateCall[] = []
    const animateFn = installAnimateMock(calls)
    await expect(animator.playFlip(root, before)).resolves.toBeUndefined()
    expect(animateFn).not.toHaveBeenCalled()
    animator.dispose()
  })

  it('returns immediately when prefs are off', async () => {
    const animator = new FlipAnimator()
    animator.setPrefs(allPrefs(false))
    const root = makeRoot()
    makeTopic(root, 'a', rectOf(0, 0))
    const before = animator.capture(root)
    stubRect(root.querySelector('.topic') as HTMLElement, rectOf(100, 100))

    const calls: AnimateCall[] = []
    const animateFn = installAnimateMock(calls)
    await expect(animator.playFlip(root, before)).resolves.toBeUndefined()
    expect(animateFn).not.toHaveBeenCalled()

    // flipEnabled off alone also skips.
    animator.setPrefs({ ...allPrefs(true), flipEnabled: false })
    await expect(animator.playFlip(root, before)).resolves.toBeUndefined()
    expect(animateFn).not.toHaveBeenCalled()
    animator.dispose()
  })

  it('revealNew animates only fresh elements with stagger', () => {
    const animator = new FlipAnimator()
    animator.setPrefs(allPrefs(true))
    const root = makeRoot()
    makeTopic(root, 'a', rectOf(0, 0))
    const before = animator.capture(root)
    expect(before.size).toBe(1)

    makeTopic(root, 'b', rectOf(0, 40))
    makeTopic(root, 'c', rectOf(0, 80))

    const calls: AnimateCall[] = []
    installAnimateMock(calls)
    animator.revealNew(root, before)

    // Two appear animations, staggered by 70ms.
    expect(calls).toHaveLength(2)
    expect(calls[0]?.options?.delay).toBe(0)
    expect(calls[1]?.options?.delay).toBe(70)
    const start = calls[0]?.keyframes[0] as Record<string, unknown>
    expect(start['opacity']).toBe('0')
    expect(start['transform']).toBe('translateY(14px) scale(0.78)')
    animator.dispose()
  })

  it('revealNew also animates the edit box covering a new node', () => {
    const animator = new FlipAnimator()
    animator.setPrefs(allPrefs(true))
    const root = makeRoot()
    makeTopic(root, 'a', rectOf(0, 0))
    const before = animator.capture(root)

    makeTopic(root, 'b', rectOf(0, 40))
    const box = document.createElement('div')
    box.id = 'input-box'
    stubRect(box, rectOf(0, 40, 130, 44))
    root.appendChild(box)

    const calls: AnimateCall[] = []
    installAnimateMock(calls)
    animator.revealNew(root, before)

    // One appear for the node + one for the covering edit box.
    expect(calls).toHaveLength(2)
    animator.dispose()
  })

  it('revealNewEdges draws only unseen edges and cleans up', async () => {
    const animator = new FlipAnimator();
    animator.setPrefs(allPrefs(true));
    const root = makeRoot();
    const existing = makeEdge(root, 'M0 0L10 10', 100);
    const before = animator.captureEdges(root);
    expect(before.size).toBe(1);
    // Reflow changes geometry, but not the connector's child identity.
    existing.setAttribute('d', 'M0 0L30 30');

    const fresh = makeEdge(root, 'M0 0L20 20', 200);
    makeEdge(root, null, 50); // empty d is skipped

    const calls: AnimateCall[] = [];
    installAnimateMock(calls);
    animator.revealNewEdges(root, before);

    expect(calls).toHaveLength(1);
    const frames = calls[0]?.keyframes as Array<Record<string, unknown>>;
    expect(frames[0]?.['strokeDashoffset']).toBe('200');
    expect(frames[1]?.['strokeDashoffset']).toBe('0');

    // Cleanup after finish removes the temporary dash styles.
    await new Promise((r) => setTimeout(r, 0));
    expect((fresh as unknown as HTMLElement).style.strokeDasharray).toBe('');
    expect((fresh as unknown as HTMLElement).style.strokeDashoffset).toBe('');
    animator.dispose();
  });

  it('revealNew does nothing when prefs are off', () => {
    const animator = new FlipAnimator()
    animator.setPrefs(allPrefs(false))
    const root = makeRoot()
    makeTopic(root, 'a', rectOf(0, 0))
    const before = animator.capture(root)

    makeTopic(root, 'b', rectOf(0, 40))

    const calls: AnimateCall[] = []
    installAnimateMock(calls)
    animator.revealNew(root, before)
    expect(calls).toHaveLength(0)
    animator.dispose()
  })

  it('cancelling an edge immediately restores original dash styles', () => {
    const animator = new FlipAnimator()
    animator.setPrefs(allPrefs(true))
    const root = makeRoot()
    const edge = makeEdge(root, 'M0 0L20 20', 200)
    edge.style.setProperty('stroke-dasharray', '8,2', 'important')
    edge.style.strokeDashoffset = '3'
    let rejectFinished: (reason?: unknown) => void = () => undefined
    const finished = new Promise<Animation>((_resolve, reject) => { rejectFinished = reject })
    const cancel = vi.fn(() => rejectFinished(new Error('cancelled')))
    vi.spyOn(Element.prototype, 'animate').mockReturnValue({ finished, cancel } as unknown as Animation)

    animator.revealNewEdges(root, new Set())
    expect(edge.style.strokeDasharray).toBe('200')
    animator.cancelAll()
    expect(cancel).toHaveBeenCalledOnce()
    expect(edge.style.strokeDasharray).toBe('8,2')
    expect(edge.style.getPropertyPriority('stroke-dasharray')).toBe('important')
    expect(edge.style.strokeDashoffset).toBe('3')
    animator.dispose()
  })

  it('skips drawing edges when only the edge setting is disabled', () => {
    const animator = new FlipAnimator()
    animator.setPrefs({ ...allPrefs(true), edgeEffect: false })
    const root = makeRoot()
    const edge = makeEdge(root, 'M0 0L20 20', 200)
    const calls: AnimateCall[] = []
    installAnimateMock(calls)
    animator.revealNewEdges(root, new Set())
    expect(calls).toHaveLength(0)
    expect(edge.style.strokeDasharray).toBe('')
    animator.dispose()
  })

  it('cancelAll leaves no running animations', () => {
    const animator = new FlipAnimator()
    animator.setPrefs(allPrefs(true))
    const calls: AnimateCall[] = []
    installAnimateMock(calls)
    const el = document.createElement('div')
    document.body.appendChild(el)
    animator.animateAppear(el)
    animator.pulse(el)
    animator.cancelAll()
    const running = (animator as unknown as { running: Set<Animation> }).running
    expect(running.size).toBe(0)
    animator.dispose()
  })

  it('dims existing edges during reflow, excluding newly added edges', async () => {
    const animator = new FlipAnimator()
    const root = makeRoot()
    const existing = makeEdge(root, 'M0 0L10 10', 100, 'existing')
    existing.style.opacity = '1'
    const topic = root.querySelector<HTMLElement>('me-tpc')!
    stubRect(topic, rectOf(0, 0))
    const before = animator.capture(root)
    const fresh = makeEdge(root, 'M0 0L20 20', 200, 'fresh')
    fresh.style.opacity = '1'
    stubRect(topic, rectOf(10, 20))
    const calls: AnimateCall[] = []
    installAnimateMock(calls)

    await animator.playFlip(root, before)
    const dim = calls.find(({ target }) => target === existing)
    expect(dim).toBeDefined()
    expect(dim?.keyframes.map((frame) => frame.opacity)).toEqual([0.25, 0.25, 1])
    expect(dim?.keyframes[1]?.offset).toBeLessThan(1)
    expect(calls.some(({ target }) => target === fresh)).toBe(false)
    expect(existing.style.opacity).toBe('1')
    animator.dispose()
  })

  it('restores the original opacity rather than forcing existing edges opaque', async () => {
    const animator = new FlipAnimator()
    const root = makeRoot()
    const edge = makeEdge(root, 'M0 0L10 10', 100)
    edge.style.setProperty('opacity', '0.4', 'important')
    const topic = root.querySelector<HTMLElement>('me-tpc')!
    stubRect(topic, rectOf(0, 0))
    const before = animator.capture(root)
    stubRect(topic, rectOf(0, 20))
    const calls: AnimateCall[] = []
    installAnimateMock(calls)
    await animator.playFlip(root, before)

    const dim = calls.find(({ target }) => target === edge)
    expect(dim?.keyframes.map((frame) => frame.opacity)).toEqual([0.1, 0.1, 0.4])
    expect(edge.style.opacity).toBe('0.4')
    expect(edge.style.getPropertyPriority('opacity')).toBe('important')
    animator.dispose()
  })

  it('skips dimming when nodes did not move or the dimming setting is off', async () => {
    const animator = new FlipAnimator()
    const root = makeRoot()
    const edge = makeEdge(root, 'M0 0L10 10', 100)
    edge.style.opacity = '1'
    const topic = root.querySelector<HTMLElement>('me-tpc')!
    stubRect(topic, rectOf(0, 0))
    const before = animator.capture(root)
    const calls: AnimateCall[] = []
    installAnimateMock(calls)
    await animator.playFlip(root, before)
    expect(calls).toHaveLength(0)

    animator.setPrefs({ ...allPrefs(true), dimExistingEdges: false })
    stubRect(topic, rectOf(0, 20))
    await animator.playFlip(root, before)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.target).toBe(topic)
    animator.dispose()
  })

  it('restarting dimming does not compound opacity, and cancellation removes effects', async () => {
    const animator = new FlipAnimator()
    const root = makeRoot()
    const edge = makeEdge(root, 'M0 0L10 10', 100)
    edge.style.opacity = '1'
    const topic = root.querySelector<HTMLElement>('me-tpc')!
    stubRect(topic, rectOf(0, 0))
    const before = animator.capture(root)
    stubRect(topic, rectOf(0, 20))
    const animations: Array<{ finished: Promise<Animation>; cancel: ReturnType<typeof vi.fn> }> = []
    const calls: AnimateCall[] = []
    const animate = function (this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions): Animation {
      calls.push({ target: this, keyframes: keyframes as Keyframe[],
        options: typeof options === 'number' ? { duration: options } : options })
      let rejectFinished: (reason?: unknown) => void = () => undefined
      const finished = new Promise<Animation>((_resolve, reject) => { rejectFinished = reject })
      const animation = { finished, cancel: vi.fn(() => rejectFinished(new Error('cancelled'))) }
      animations.push(animation)
      return animation as unknown as Animation
    }
    vi.spyOn(Element.prototype, 'animate').mockImplementation(animate)
    vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(animate)

    const first = animator.playFlip(root, before)
    // Simulate getComputedStyle reading a currently dimmed edge on the next op.
    const realGetComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => el === edge
      ? { opacity: '0.25' } as CSSStyleDeclaration : realGetComputedStyle(el))
    const next = animator.playFlip(root, before)
    expect(calls.filter(({ target }) => target === edge).map(({ keyframes }) => keyframes[0]?.opacity))
      .toEqual([0.25, 0.25])
    animator.setPrefs({ ...allPrefs(true), dimExistingEdges: false })
    expect(animations.every(({ cancel }) => cancel.mock.calls.length > 0)).toBe(true)
    expect((animator as unknown as { dimmedEdges: Map<Element, unknown> }).dimmedEdges.size).toBe(0)
    await Promise.all([first, next])
    expect(edge.style.opacity).toBe('1')
    animator.dispose()
  })

  it('Reduced Motion skips both node motion and existing-edge dimming', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)
    const animator = new FlipAnimator()
    const root = makeRoot()
    const edge = makeEdge(root, 'M0 0L10 10', 100)
    edge.style.opacity = '1'
    const topic = root.querySelector<HTMLElement>('me-tpc')!
    stubRect(topic, rectOf(0, 0))
    const before = animator.capture(root)
    stubRect(topic, rectOf(0, 20))
    const calls: AnimateCall[] = []
    installAnimateMock(calls)
    await animator.playFlip(root, before)
    expect(calls).toHaveLength(0)
    animator.dispose()
  })

  it('works without matchMedia', async () => {
    const desc = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    try {
      // Simulate environment without matchMedia.
      Object.defineProperty(window, 'matchMedia', {
        value: undefined,
        writable: true,
        configurable: true,
      })
      const animator = new FlipAnimator()
      const root = makeRoot()
      makeTopic(root, 'a', rectOf(0, 0))
      const before = animator.capture(root)
      await expect(animator.playFlip(root, before)).resolves.toBeUndefined()
      animator.cancelAll()
      animator.dispose()
    } finally {
      if (desc) Object.defineProperty(window, 'matchMedia', desc)
    }
  })

  it('honors a reduced-motion change before its asynchronous event arrives', () => {
    const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.mocked(window.matchMedia).mockReturnValue(media as unknown as MediaQueryList)
    const animator = new FlipAnimator()
    const calls: AnimateCall[] = []
    installAnimateMock(calls)
    const node = document.createElement('div')
    animator.animateAppear(node)
    expect(calls).toHaveLength(1)
    media.matches = true
    animator.animateAppear(node)
    expect(calls).toHaveLength(1)
    animator.dispose()
  })
})
