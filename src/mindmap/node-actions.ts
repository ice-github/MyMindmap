// Node operations over a mind-elixir instance.
//
// Each function receives the instance as an argument (no cyclic imports).
// addChild et al. return Promise<void>; awaiting them means layout is settled,
// so callers can measure DOM afterwards (e.g. for FLIP animation).
// Guards throw on missing selection / root removal; callers surface them.

function currentOrThrow(mind: any, action: string): any {
  const el = mind?.currentNode ?? null
  if (!el) throw new Error(`No node selected (${action})`)
  return el
}

function isRootElement(el: any): boolean {
  try {
    return !!el?.nodeObj && !el.nodeObj.parent
  } catch {
    return false
  }
}

function getRootElement(mind: any): any | null {
  try {
    const found = mind?.map?.querySelector?.('me-root>me-tpc')
    if (found) return found
  } catch {
    // Fall through to the id-based lookup.
  }
  try {
    const id = mind?.nodeData?.id
    if (id != null && typeof mind?.findEle === 'function') return mind.findEle(id)
  } catch {
    // findEle throws when the node cannot be resolved.
  }
  return null
}

function selectedOrThrow(mind: any, action: string): any[] {
  const targets: any[] = (mind?.currentNodes ?? []).filter(Boolean)
  if (targets.length === 0) throw new Error(`No node selected (${action})`)
  return targets
}

export async function addChildNode(mind: any): Promise<void> {
  const target = mind?.currentNode ?? getRootElement(mind)
  if (!target) throw new Error('No node selected (add child)')
  await mind.addChild(target)
}

export async function addSiblingNode(mind: any): Promise<void> {
  const target = currentOrThrow(mind, 'add sibling')
  if (isRootElement(target)) throw new Error('Cannot add a sibling to the root node')
  await mind.insertSibling('after', target)
}

export async function removeSelected(mind: any): Promise<void> {
  const targets = selectedOrThrow(mind, 'remove')
  if (targets.some(isRootElement)) throw new Error('Cannot remove the root node')
  await mind.removeNodes(targets)
}

export function expandToggle(mind: any): void {
  const target = currentOrThrow(mind, 'expand')
  // mind-elixir assumes an expander element exists; leaf nodes have none and
  // would throw inside expandNode, so toggling them is a no-op.
  const children = target?.nodeObj?.children
  if (!Array.isArray(children) || children.length === 0) return
  mind.expandNode(target)
}

export function expandAll(mind: any, expand: boolean): void {
  const root = getRootElement(mind)
  if (!root) throw new Error('Root node not found (expand all)')
  mind.expandNodeAll(root, expand)
}

export async function moveUp(mind: any): Promise<void> {
  const target = currentOrThrow(mind, 'move up')
  await mind.moveUpNode(target)
}

export async function moveDown(mind: any): Promise<void> {
  const target = currentOrThrow(mind, 'move down')
  await mind.moveDownNode(target)
}

/** Alias kept for callers using mind-elixir's method naming. */
export const moveUpNode = moveUp

/** Alias kept for callers using mind-elixir's method naming. */
export const moveDownNode = moveDown

export function undo(mind: any): void {
  if (typeof mind?.undo !== 'function') throw new Error('Undo is not available')
  mind.undo()
}

export function redo(mind: any): void {
  if (typeof mind?.redo !== 'function') throw new Error('Redo is not available')
  mind.redo()
}

export function centerView(mind: any): void {
  if (!mind) throw new Error('Mindmap is not initialized (center)')
  mind.toCenter()
}

export function fitView(mind: any): void {
  if (!mind) throw new Error('Mindmap is not initialized (fit)')
  mind.scaleFit()
}

/** True while the user edits text (input/textarea/select/contentEditable/mind-elixir edit box). */
export function isEditingText(): boolean {
  if (typeof document === 'undefined') return false
  const active = document.activeElement as HTMLElement | null
  if (!active || active === document.body) return false
  if (active.id === 'input-box') return true
  if (active.isContentEditable) return true
  const tag = active.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
