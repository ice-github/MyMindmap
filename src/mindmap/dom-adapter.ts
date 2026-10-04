// DOM access isolated to this module.
//
// mind-elixir renders topics as `me-tpc` elements carrying `nodeObj` and a
// `data-nodeid="me<id>"` attribute. That structure is undocumented, so every
// direct query lives here. Application code must use these helpers instead of
// touching mind-elixir managed DOM. Connector lookup is isolated here as well.
import type { Topic } from 'mind-elixir'

export type TopicEl = HTMLElement & { nodeObj?: any }

/** Selector covering mind-elixir topic elements (current `me-tpc` tag plus legacy `.topic` class). */
const TOPIC_SELECTOR = 'me-tpc, .topic'

const NODE_ID_PREFIX = 'me'

function stripNodeIdPrefix(raw: string): string {
  return raw.startsWith(NODE_ID_PREFIX) ? raw.slice(NODE_ID_PREFIX.length) : raw
}

/** All topic elements under `root` (collapsed subtrees are absent from the DOM). */
export function getTopicElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll(TOPIC_SELECTOR)) as HTMLElement[]
}

/** Resolve a topic element's node id via `nodeObj.id`, falling back to `data-nodeid`. */
export function getTopicId(el: HTMLElement): string | null {
  const objId = (el as TopicEl).nodeObj?.id
  if (typeof objId === 'string' && objId.length > 0) return objId
  if (typeof objId === 'number') return String(objId)
  const attr = el.getAttribute('data-nodeid')
  if (attr && attr.length > 0) return stripNodeIdPrefix(attr)
  return null
}

function escapeAttr(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value
}

/** Find a topic element by node id: `mind.findEle` first, DOM query as fallback. Never throws. */
export function getTopicById(mind: any, id: string): HTMLElement | null {
  try {
    if (mind && typeof mind.findEle === 'function') {
      const found = mind.findEle(id) as Topic | undefined
      if (found) return found as unknown as HTMLElement
    }
  } catch {
    // findEle throws when the node is missing or collapsed; try the DOM fallback.
  }
  try {
    const scope: ParentNode =
      (mind?.map as ParentNode | undefined) ??
      (mind?.container as ParentNode | undefined) ??
      (mind?.el as ParentNode | undefined) ??
      document
    const attr = `${NODE_ID_PREFIX}${id}`
    return scope.querySelector(`[data-nodeid="${escapeAttr(attr)}"]`) as HTMLElement | null
  } catch {
    return null
  }
}

/**
 * Find mind-elixir's inline edit box (`#input-box`) under `root`, if present.
 * It overlays the edited node, so node animations play behind it. Never throws.
 */
export function getInputBox(root: ParentNode): HTMLElement | null {
  try {
    return root.querySelector('#input-box') as HTMLElement | null
  } catch {
    return null
  }
}

/**
 * Mind Elixir v5 sizes the inline editor using `offsetWidth - 8`. With the
 * app's global border-box rule that makes it visibly narrower than the topic.
 * Keep the temporary editor aligned to the exact rendered topic width.
 */
export function matchInputBoxToTopic(root: HTMLElement, nodeId: string): void {
  const topic = getTopicElements(root).find((el) => getTopicId(el) === nodeId)
  const input = getInputBox(root)
  if (!topic || !input) return
  input.style.minWidth = `${topic.offsetWidth}px`
}

/**
 * v5 rebuilds connectors without ids. Main paths follow main-wrapper order;
 * subpaths follow descendant-wrapper preorder. Key each by its child node id,
 * not its changing geometry. Unexpected structures simply skip the effect.
 */
export function getNodeEdges(root: ParentNode): Map<string, SVGPathElement> {
  const edges = new Map<string, SVGPathElement>()
  const mainWrappers = Array.from(root.querySelectorAll<HTMLElement>('me-main > me-wrapper'))
  const mainPaths = Array.from(root.querySelectorAll<SVGPathElement>('svg.lines > path'))
  if (mainWrappers.length !== mainPaths.length) return edges

  const bind = (topic: HTMLElement | null, path: SVGPathElement): void => {
    if (!topic || !path.getAttribute('d')) return
    const id = getTopicId(topic)
    if (id) edges.set(id, path)
  }
  mainWrappers.forEach((wrapper, index) => {
    bind(wrapper.querySelector<HTMLElement>(':scope > me-parent > me-tpc'), mainPaths[index])
    const children = Array.from(wrapper.querySelectorAll<HTMLElement>(
      'me-children > me-wrapper > me-parent > me-tpc',
    ))
    const paths = Array.from(wrapper.querySelectorAll<SVGPathElement>(':scope > svg.subLines > path'))
    if (children.length !== paths.length) return
    children.forEach((topic, childIndex) => bind(topic, paths[childIndex]))
  })
  return edges
}

/** Select dash-offset sign so connectors grow from parent toward child. */
export function getEdgeDrawOffset(root: HTMLElement, nodeId: string, path: SVGPathElement, length: number): number {
  try {
    const topic = getTopicElements(root).find((el) => getTopicId(el) === nodeId)
    if (!topic) return length
    const rect = topic.getBoundingClientRect()
    const matrix = path.getScreenCTM()
    if (!matrix) return length
    const start = path.getPointAtLength(0).matrixTransform(matrix)
    const end = path.getPointAtLength(length).matrixTransform(matrix)
    const cx = (rect.left + rect.right) / 2
    const cy = (rect.top + rect.bottom) / 2
    const distance = (point: DOMPoint): number => Math.hypot(point.x - cx, point.y - cy)
    return distance(start) < distance(end) ? -length : length
  } catch {
    return length
  }
}
