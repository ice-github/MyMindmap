// Mind Elixir lifecycle owner: init / data access / preferences / disposal.
//
// mind-elixir is the source of truth for structure and layout. This controller
// only wraps public APIs (init, getData, refresh, findEle, toCenter, ...).
// The runtime bus exposes `addListener`/`removeListener` (not `.on`), so every
// subscription goes through a guarded helper that tolerates either shape.
import MindElixir from 'mind-elixir'
import type { Before, MindElixirData } from 'mind-elixir'
import { matchInputBoxToTopic } from './dom-adapter.js'

export type MindmapEvents = {
  onDataChange(operationName?: string): void
  onSelect(hasSelection: boolean, isRoot: boolean): void
  /** Fires from mind-elixir `before` hooks, i.e. before a structural op changes layout. */
  onBeforeOperation(): void
}

export type MindmapPreferences = {
  editable: boolean
  dragEnabled: boolean
  contextMenuEnabled: boolean
  shortcutsEnabled: boolean
}

type BusSubscription = {
  type: string
  handler: (...args: any[]) => void
}

type OperationInfo = { name?: string; obj?: { id?: string } }

// Structural ops whose layout change should animate, whatever triggered them
// (toolbar, keyboard shortcut, context menu, drag-drop).
const ANIMATED_OPS = [
  'addChild',
  'insertSibling',
  'insertParent',
  'removeNodes',
  'moveUpNode',
  'moveDownNode',
  'moveNodeIn',
  'moveNodeBefore',
  'moveNodeAfter',
  'reshapeNode',
  'copyNode',
  'copyNodes',
] as const

export class MindmapController {
  private container: HTMLElement
  private events: MindmapEvents
  private instance: any = null
  private busSubscriptions: BusSubscription[] = []
  private layoutKeyTarget: HTMLElement | null = null
  private layoutKeyHandler: ((event: KeyboardEvent) => void) | null = null
  private moveSourceId: string | null = null

  private editableState = true
  private dragEnabled = true
  private contextMenuEnabled = true
  private shortcutsEnabled = true

  constructor(container: HTMLElement, events: MindmapEvents) {
    this.container = container
    this.events = events
  }

  async init(data: MindElixirData): Promise<void> {
    this.destroy()
    // NOTE: `before` hooks must return `true` to let the operation proceed;
    // returning undefined would veto it (see mind-elixir's wrapper).
    const before: Before = {
      // Suppress programmatic beginEdit while not editable; dblclick editing
      // is already gated by mind-elixir itself via enableEdit/disableEdit.
      beginEdit: () => this.editableState,
    }
    for (const name of ANIMATED_OPS) {
      ;(before as Record<string, (...args: never[]) => boolean>)[name] = () => {
        try {
          this.events.onBeforeOperation()
        } catch {
          // Snapshot capture is best-effort; never block the operation.
        }
        return true
      }
    }
    const mind = new MindElixir({
      el: this.container,
      direction: data.direction ?? MindElixir.RIGHT,
      editable: this.editableState,
      draggable: this.dragEnabled,
      contextMenu: this.contextMenuEnabled,
      toolBar: false,
      keypress: true,
      allowUndo: true,
      newTopicName: 'New Node',
      before,
    })
    const result: unknown = mind.init(data)
    if (result instanceof Error) throw result
    this.instance = mind
    this.wireEvents()
    this.wireLayoutShortcuts()
    this.setEditable(this.editableState)
    this.setDraggable(this.dragEnabled)
    this.setContextMenu(this.contextMenuEnabled)
    this.setShortcuts(this.shortcutsEnabled)
    this.notifySelection()
  }

  get mind(): any {
    return this.instance
  }

  getData(): MindElixirData {
    return this.requireMind().getData()
  }

  refresh(data: MindElixirData): void {
    const mind = this.requireMind()
    mind.refresh(data)
    try {
      if (typeof mind.clearHistory === 'function') mind.clearHistory()
    } catch {
      // History reset is best-effort (only exists when allowUndo is on).
    }
  }

  setEditable(editable: boolean): void {
    this.editableState = editable
    const mind = this.instance
    if (!mind) return
    try {
      if (editable) {
        if (typeof mind.enableEdit === 'function') mind.enableEdit()
        else mind.editable = true
      } else {
        if (typeof mind.disableEdit === 'function') mind.disableEdit()
        else mind.editable = false
      }
    } catch {
      try {
        mind.editable = editable
      } catch {
        // Ignore: instance may be partially torn down.
      }
    }
  }

  setDraggable(v: boolean): void {
    this.dragEnabled = v
    const mind = this.instance
    if (!mind) return
    try {
      mind.draggable = v
    } catch {
      // v5 deprecates `draggable`; assignment is best-effort.
    }
  }

  setContextMenu(v: boolean): void {
    this.contextMenuEnabled = v
    const mind = this.instance
    if (!mind) return
    try {
      mind.contextMenu = v
    } catch {
      // Flag-only update; full effect applies on next init.
    }
  }

  setShortcuts(v: boolean): void {
    this.shortcutsEnabled = v
    const mind = this.instance
    if (!mind) return
    try {
      mind.keypress = v
    } catch {
      // Ignore when the runtime does not expose the flag.
    }
  }

  applyPreferences(p: MindmapPreferences): void {
    this.setEditable(p.editable)
    this.setDraggable(p.dragEnabled)
    this.setContextMenu(p.contextMenuEnabled)
    this.setShortcuts(p.shortcutsEnabled)
  }

  destroy(): void {
    this.setMoveSource(null)
    this.unsubscribeAll()
    if (this.layoutKeyTarget && this.layoutKeyHandler) {
      this.layoutKeyTarget.removeEventListener('keydown', this.layoutKeyHandler, true)
    }
    this.layoutKeyTarget = null
    this.layoutKeyHandler = null
    const mind = this.instance
    this.instance = null
    if (!mind) return
    try {
      if (typeof mind.destroy === 'function') mind.destroy()
    } catch {
      // Ignore errors during teardown.
    }
  }

  private requireMind(): any {
    if (!this.instance) throw new Error('Mindmap is not initialized')
    return this.instance
  }

  private handleOperation = (info?: OperationInfo): void => {
    if (info?.name === 'beginEdit' && typeof info.obj?.id === 'string') {
      matchInputBoxToTopic(this.container, info.obj.id)
    }
    this.events.onDataChange(info?.name)
    this.notifySelection()
  }

  private handleSelectionChange = (): void => {
    this.notifySelection()
  }

  /**
   * Mind Elixir's Ctrl+Arrow layout shortcuts call refresh(), which clears all
   * selections. Preserve the currently focused node across that public API.
   */
  private wireLayoutShortcuts(): void {
    const target = this.instance?.container as HTMLElement | undefined
    if (!target) return
    const handler = (event: KeyboardEvent): void => {
      if (this.moveSourceId) {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopImmediatePropagation()
          this.setMoveSource(null)
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopImmediatePropagation()
          void this.moveToCurrent(event.shiftKey ? 'before' : event.ctrlKey || event.metaKey ? 'after' : 'in')
          return
        }
      }
      const targetElement = event.target instanceof HTMLElement ? event.target : null
      if (targetElement?.id === 'input-box' || targetElement?.isContentEditable) return
      if (this.shortcutsEnabled && !this.moveSourceId && event.code === 'Space') {
        const mind = this.instance
        const selected = mind?.currentNode ?? mind?.currentNodes?.[0]
        if (selected?.nodeObj?.children?.length) {
          event.preventDefault()
          event.stopImmediatePropagation()
          try {
            this.events.onBeforeOperation()
            mind.expandNode(selected)
            this.events.onDataChange('expandNode')
            this.notifySelection()
          } catch {
            // Ignore when the selected node cannot be expanded/collapsed.
          }
          return
        }
      }
      if (
        this.shortcutsEnabled && !this.moveSourceId && (event.ctrlKey || event.metaKey) && event.shiftKey &&
        !event.altKey && event.key.toLowerCase() === 'e'
      ) {
        const mind = this.instance
        const rootId = mind?.nodeData?.id
        const selectedId = (mind?.currentNode ?? mind?.currentNodes?.[0])?.nodeObj?.id
        if (typeof rootId === 'string') {
          event.preventDefault()
          event.stopImmediatePropagation()
          try {
            this.events.onBeforeOperation()
            const root = mind.findEle(rootId)
            mind.expandNodeAll(root, true)
            if (typeof selectedId === 'string') {
              const selected = mind.findEle(selectedId)
              if (selected) mind.selectNode(selected)
            }
            this.events.onDataChange('expandAll')
            this.notifySelection()
          } catch {
            // Expanding all is best-effort when a map is being refreshed.
          }
          return
        }
      }
      if (
        this.shortcutsEnabled && !this.moveSourceId && (event.ctrlKey || event.metaKey) && event.shiftKey &&
        !event.altKey && event.key.toLowerCase() === 'f'
      ) {
        const mind = this.instance
        const selected = mind?.currentNode ?? mind?.currentNodes?.[0]
        const selectedId = selected?.nodeObj?.id
        if (typeof selectedId === 'string') {
          event.preventDefault()
          event.stopImmediatePropagation()
          this.focusSelectedPath(mind, selectedId)
          return
        }
      }
      if (
        this.shortcutsEnabled && this.editableState && event.altKey &&
        !event.ctrlKey && !event.metaKey &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      ) {
        const mind = this.instance
        const selected = mind?.currentNode ?? mind?.currentNodes?.[0]
        const node = selected?.nodeObj
        // In a two-sided layout only first-level branches have an independent
        // side. Alt+Left/Right reassigns that branch; deeper nodes keep their
        // spatial-navigation behavior.
        if (mind?.direction === 2 && node?.parent && !node.parent.parent) {
          event.preventDefault()
          event.stopImmediatePropagation()
          const id = node.id
          const direction = event.key === 'ArrowLeft' ? 0 : 1
          if (node.direction !== direction) {
            void this.moveBranchToSide(mind, selected, id, direction)
          }
          return
        }
      }
      if (!this.shortcutsEnabled || (!event.ctrlKey && !event.metaKey) || event.altKey) return
      if (event.key.toLowerCase() === 'm' && this.editableState) {
        const selected = this.instance?.currentNode ?? this.instance?.currentNodes?.[0]
        const id = selected?.nodeObj?.id
        if (typeof id === 'string' && !selected.nodeObj.root) {
          event.preventDefault()
          event.stopImmediatePropagation()
          this.setMoveSource(id)
        }
        return
      }
      const method = event.key === 'ArrowUp'
        ? 'initSide'
        : event.key === 'ArrowLeft'
          ? 'initLeft'
          : event.key === 'ArrowRight'
            ? 'initRight'
            : null
      if (!method) return
      const mind = this.instance
      if (!mind) return
      const selected = mind.currentNode ?? mind.currentNodes?.[0] ?? null
      const id = selected?.nodeObj?.id
      event.preventDefault()
      // Stop Mind Elixir's bubble-phase handler from repeating the refresh.
      event.stopImmediatePropagation()
      try {
        this.events.onBeforeOperation()
        mind[method]()
        if (typeof id === 'string' && typeof mind.findEle === 'function' && typeof mind.selectNode === 'function') {
          const topic = mind.findEle(id)
          if (topic) mind.selectNode(topic)
        }
        // Layout shortcuts do not emit an `operation` event, so explicitly
        // persist the changed direction and consume the FLIP snapshot.
        this.events.onDataChange('changeDirection')
        this.notifySelection()
      } catch {
        // Layout changes are best-effort.
      }
    }
    target.addEventListener('keydown', handler, true)
    this.layoutKeyTarget = target
    this.layoutKeyHandler = handler
  }

  private focusSelectedPath(mind: any, selectedId: string): void {
    try {
      const data = mind.getData()
      const path = new Set<string>()
      const findPath = (node: any): boolean => {
        if (!node || typeof node.id !== 'string') return false
        path.add(node.id)
        if (node.id === selectedId) return true
        for (const child of node.children ?? []) {
          if (findPath(child)) return true
        }
        path.delete(node.id)
        return false
      }
      if (!findPath(data.nodeData)) return

      const setExpansion = (node: any, inSelectedSubtree = false): void => {
        const isSelected = node.id === selectedId
        const keepOpen = inSelectedSubtree || path.has(node.id)
        if (node.children?.length) node.expanded = keepOpen
        for (const child of node.children ?? []) setExpansion(child, inSelectedSubtree || isSelected)
      }
      setExpansion(data.nodeData)
      this.events.onBeforeOperation()
      mind.refresh(data)
      const selected = mind.findEle(selectedId)
      if (selected) mind.selectNode(selected)
      this.events.onDataChange('focusSelectedPath')
      this.notifySelection()
    } catch {
      // Keep the current map intact if the focus view cannot be applied.
    }
  }

  private async moveBranchToSide(
    mind: any,
    selected: any,
    id: string,
    direction: 0 | 1,
  ): Promise<void> {
    try {
      await mind.reshapeNode(selected, { direction })
      if (this.instance !== mind) return
      // reshapeNode updates the document but doesn't rebuild the left/right
      // branch containers; refresh applies the new side, then restore focus.
      mind.refresh(mind.getData())
      const topic = mind.findEle(id)
      if (topic) mind.selectNode(topic)
      this.notifySelection()
    } catch {
      // Keep the current layout intact if the library rejects a change.
    }
  }

  private setMoveSource(id: string | null): void {
    this.moveSourceId = id
    const container = this.container.parentElement
    if (!container) return
    if (id) container.dataset.moveMode = 'true'
    else delete container.dataset.moveMode
  }

  private async moveToCurrent(position: 'in' | 'before' | 'after'): Promise<void> {
    const mind = this.instance
    const sourceId = this.moveSourceId
    const targetId = mind?.currentNode?.nodeObj?.id
    if (!mind || !sourceId || typeof targetId !== 'string') return
    const source = mind.findEle(sourceId)
    const target = mind.findEle(targetId)
    const sourceData = source?.nodeObj
    const targetData = target?.nodeObj
    if (!source || !target || !sourceData || !targetData || sourceId === targetId) return
    // The central/root node has no sibling position, so before/after moves
    // relative to it are invalid in Mind Elixir and can corrupt its layout.
    if (position !== 'in' && !targetData.parent) return
    // A node cannot be moved into itself or one of its descendants.
    for (let ancestor = targetData; ancestor; ancestor = ancestor.parent) {
      if (ancestor.id === sourceId) return
    }
    const operation = position === 'in' ? 'moveNodeIn' : position === 'before' ? 'moveNodeBefore' : 'moveNodeAfter'
    try {
      await mind[operation]([source], target)
      const moved = mind.findEle(sourceId)
      if (moved) mind.selectNode(moved)
      this.setMoveSource(null)
      this.notifySelection()
    } catch {
      // Keep the move mode active so the user can choose another destination.
    }
  }

  private wireEvents(): void {
    this.subscribe('operation', this.handleOperation)
    this.subscribe('selectNodes', this.handleSelectionChange)
    this.subscribe('unselectNodes', this.handleSelectionChange)
    this.subscribe('selectNewNode', this.handleSelectionChange)
  }

  private subscribe(type: string, handler: (...args: any[]) => void): void {
    const bus = this.instance?.bus
    if (!bus) return
    try {
      if (typeof bus.on === 'function') bus.on(type, handler)
      else if (typeof bus.addListener === 'function') bus.addListener(type, handler)
      else return
      this.busSubscriptions.push({ type, handler })
    } catch {
      // Unsupported bus shape; selection/data events are best-effort.
    }
  }

  private unsubscribeAll(): void {
    const bus = this.instance?.bus
    for (const { type, handler } of this.busSubscriptions) {
      try {
        if (!bus) break
        if (typeof bus.off === 'function') bus.off(type, handler)
        else if (typeof bus.removeListener === 'function') bus.removeListener(type, handler)
      } catch {
        // Ignore teardown errors.
      }
    }
    this.busSubscriptions = []
  }

  private notifySelection(): void {
    try {
      const nodes: unknown[] = this.instance?.currentNodes ?? []
      const hasSelection = nodes.length > 0
      let isRoot = false
      if (hasSelection) {
        try {
          const obj = this.instance?.currentNode?.nodeObj
          isRoot = !!obj && !obj.parent
        } catch {
          isRoot = false
        }
      }
      this.events.onSelect(hasSelection, isRoot)
    } catch {
      // Never let selection reporting break mind-elixir flows.
    }
  }
}
