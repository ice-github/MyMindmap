import { MindmapController } from '../mindmap/mindmap.js';
import type { MindElixirData } from 'mind-elixir';
import { FlipAnimator } from '../mindmap/animations.js';
import {
  addChildNode,
  addSiblingNode,
  centerView,
  expandAll,
  expandToggle,
  fitView,
  moveDown,
  moveUp,
  redo,
  removeSelected,
  undo,
} from '../mindmap/node-actions.js';
import { createNewMapData, toPersisted, validatePersisted } from '../storage/document.js';
import { MapPersistence } from '../storage/persistence.js';
import { downloadJson, readJsonFile } from '../storage/file-io.js';
import { DEFAULT_PREFS, loadPreferences, resetPreferences, savePreferences } from '../storage/preferences.js';
import type { Preferences } from '../storage/preferences.js';
import { createToolbar } from '../ui/toolbar.js';
import type { ToolbarController } from '../ui/toolbar.js';
import { createStatus } from '../ui/status.js';
import { createSettingsPanel } from '../ui/settings-panel.js';

export type AppOptions = {
  mapContainer: HTMLElement;
  toolbarEl: HTMLElement;
  statusEl: HTMLElement;
  settingsRoot: HTMLElement;
};

export type AppHandle = {
  dispose: () => void;
};

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildExportFilename(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `mindmap-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`
  );
}

function resetHistory(mind: unknown): void {
  const holder = mind as { history?: { reset?: unknown } } | null | undefined;
  const reset = holder?.history?.reset;
  if (typeof reset === 'function') {
    try {
      (reset as () => void)();
    } catch {
      /* history reset is best-effort */
    }
  }
}

export async function createApp(options: AppOptions): Promise<AppHandle> {
  const status = createStatus(options.statusEl);
  const disposers: Array<() => void> = [];
  let disposed = false;

  const onDispose = (fn: () => void): void => {
    disposers.push(fn);
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const fn of disposers.splice(0)) {
      try {
        fn();
      } catch {
        /* dispose is best-effort */
      }
    }
  };

  let prefs: Preferences;
  try {
    prefs = loadPreferences();
  } catch (error) {
    prefs = { ...DEFAULT_PREFS };
    status.setError(`設定の読み込みに失敗したため初期値を使います: ${messageOf(error)}`);
  }

  try {
    // Cosmetic only: inherited class keeps new/collapsed nodes consistent
    // without modifying map data or refreshing Mind Elixir's layout.
    options.mapContainer.classList.toggle('subnode-borders', prefs.subnodeBorders);
    const persistence = new MapPersistence();
    const unsubscribe = persistence.onStateChange((state) => {
      if (disposed) return;
      status.setSaving(state);
      updateSaveButton(state);
    });
    onDispose(unsubscribe);
    onDispose(() => persistence.cancelPending());

    const saveNowButton = document.createElement('button');
    saveNowButton.type = 'button';
    saveNowButton.className = 'manual-save';
    saveNowButton.textContent = '今すぐ保存';
    saveNowButton.hidden = true;
    options.statusEl.after(saveNowButton);
    onDispose(() => saveNowButton.remove());

    const updateSaveButton = (state: string): void => {
      saveNowButton.hidden = prefs.autoSave || (state !== 'dirty' && state !== 'error');
    };

    let initialData: MindElixirData;
    try {
      const persisted = await persistence.load();
      if (persisted === null) {
        initialData = createNewMapData();
      } else {
        const validated = validatePersisted(persisted);
        if (validated === null) {
          status.setError('保存データが不正だったため新規作成しました');
          initialData = createNewMapData();
        } else {
          initialData = validated.data;
        }
      }
    } catch (error) {
      status.setError(`保存データの読み込みに失敗したため新規作成しました: ${messageOf(error)}`);
      initialData = createNewMapData();
    }

    const animator = new FlipAnimator();
    animator.setPrefs(prefs);
    onDispose(() => animator.dispose());

    // Pre-layout snapshot for the unified animation path. Captured from
    // mind-elixir `before` hooks so toolbar, keyboard, and context-menu ops
    // all animate; consumed when the `operation` bus event fires.
    type LayoutSnapshot = { nodes: Map<string, DOMRect>; edges: Set<string> };
    let pendingBefore: LayoutSnapshot | undefined;
    const playSnapshot = (snapshot: LayoutSnapshot, waitForLayoutRefresh = false): void => {
      // v5's operation events fire after layout, but sometimes before edit-box
      // creation. Finish the synchronous operation, then hide/reveal connectors
      // before the browser paints (without waiting for another rendered frame).
      const play = (): void => queueMicrotask(() => {
        if (disposed) return;
        try {
          animator.revealNewEdges(options.mapContainer, snapshot.edges);
          animator.revealNew(options.mapContainer, snapshot.nodes);
          void animator.playFlip(options.mapContainer, snapshot.nodes);
        } catch {
          /* animation is best-effort */
        }
      });
      // reshapeNode emits its operation event before its async wrapper resolves;
      // the caller then refreshes the map. Measure Last only after that refresh.
      if (waitForLayoutRefresh) requestAnimationFrame(play);
      else play();
    };
    const captureBefore = (): LayoutSnapshot | undefined => {
      if (!prefs.animationEnabled || (!prefs.flipEnabled && !prefs.appearEffect && !prefs.edgeEffect)) return undefined;
      try {
        return {
          nodes: animator.capture(options.mapContainer),
          edges: animator.captureEdges(options.mapContainer),
        };
      } catch {
        return undefined;
      }
    };

    const runOp = (fn: () => unknown): void => {
      try {
        const r = fn();
        if (r instanceof Promise) {
          r.catch((error: unknown) => status.setError(messageOf(error)));
        }
      } catch (error) {
        status.setError(messageOf(error));
      }
    };

    // expandNode has no `before` hook, so snapshot synchronously (it is sync).
    const withSyncFlip = (fn: () => void): void => {
      const before = prefs.animationEnabled ? captureBefore() : undefined;
      try {
        fn();
      } catch (error) {
        status.setError(messageOf(error));
        return;
      }
      if (before !== undefined) playSnapshot(before);
    };

    let toolbar: ToolbarController | undefined;
    let selection = { hasSelection: false, isRoot: true };
    const applySelection = (): void => {
      toolbar?.setToolbarState({
        hasSelection: selection.hasSelection,
        isRoot: selection.isRoot,
        canEdit: prefs.editable,
      });
    };

    let ready = false;
    const controller = new MindmapController(options.mapContainer, {
      onBeforeOperation: () => {
        if (!ready || disposed) return;
        pendingBefore = captureBefore();
      },
      onDataChange: (operationName?: string) => {
        if (!ready || disposed) return;
        status.setError(null);
        const snapshot = pendingBefore;
        pendingBefore = undefined;
        if (snapshot !== undefined) playSnapshot(snapshot, operationName === 'reshapeNode');
        try {
          if (prefs.autoSave) {
            persistence.saveQueued(controller.getData());
          } else {
            status.setSaving('dirty');
            updateSaveButton('dirty');
          }
        } catch (error) {
          status.setError(messageOf(error));
        }
      },
      onSelect: (hasSelection: boolean, isRoot: boolean) => {
        if (!ready || disposed) return;
        selection = { hasSelection, isRoot };
        applySelection();
      },
    });
    await controller.init(initialData);
    if (disposed) {
      controller.destroy();
      return { dispose };
    }
    onDispose(() => controller.destroy());
    ready = true;

    // 初期表示でも「子を追加」から迷わず始められるよう、ルートを選択状態にする。
    try {
      const mind = controller.mind;
      const rootId: unknown = mind?.nodeData?.id;
      if (typeof rootId === 'string' && typeof mind?.findEle === 'function' && typeof mind?.selectNode === 'function') {
        mind.selectNode(mind.findEle(rootId));
      }
    } catch {
      /* ルート 自動選択は best-effort */
    }

    saveNowButton.addEventListener('click', () => {
      void (async () => {
        try {
          status.setError(null);
          await persistence.saveNow(controller.getData());
        } catch (error) {
          status.setError(messageOf(error));
        }
      })();
    });

    const applyPrefs = (next: Preferences): void => {
      const autoSaveJustEnabled = next.autoSave && !prefs.autoSave;
      prefs = next;
      options.mapContainer.classList.toggle('subnode-borders', next.subnodeBorders);
      controller.applyPreferences(next);
      animator.setPrefs(next);
      toolbar?.setVisible(next.toolbarVisible);
      applySelection();
      if (autoSaveJustEnabled) {
        try {
          persistence.saveQueued(controller.getData());
        } catch (error) {
          status.setError(messageOf(error));
        }
      } else if (!next.autoSave) {
        persistence.cancelPending();
        status.setSaving('dirty');
        updateSaveButton('dirty');
      }
    };

    async function handleNew(): Promise<void> {
      if (!window.confirm('現在の内容を破棄して新規作成しますか？')) return;
      try {
        const data = createNewMapData();
        controller.refresh(data);
        resetHistory(controller.mind);
        selection = { hasSelection: false, isRoot: true };
        applySelection();
        status.setError(null);
        await persistence.saveNow(data);
      } catch (error) {
        status.setError(messageOf(error));
      }
    }

    async function handleImport(file: File): Promise<void> {
      if (!window.confirm('現在の内容を破棄してファイルを読み込みますか？')) return;
      try {
        const parsed: unknown = await readJsonFile(file, MAX_IMPORT_BYTES);
        const validated = validatePersisted(parsed);
        if (validated === null) throw new Error('ファイル形式が正しくありません');
        controller.refresh(validated.data);
        resetHistory(controller.mind);
        selection = { hasSelection: false, isRoot: true };
        applySelection();
        status.setError(null);
        await persistence.saveNow(validated.data);
      } catch (error) {
        status.setError(`読み込みに失敗しました: ${messageOf(error)}`);
      }
    }

    function handleExport(): void {
      try {
        const persisted = toPersisted(controller.getData());
        downloadJson(buildExportFilename(), persisted);
        status.setError(null);
      } catch (error) {
        status.setError(`書き出しに失敗しました: ${messageOf(error)}`);
      }
    }

    const panel = createSettingsPanel(options.settingsRoot, {
      get: () => prefs,
      onChange: (next: Preferences) => {
        panel.setError(null);
        let saved = false;
        try {
          saved = savePreferences(next);
        } catch (error) {
          panel.setError(`設定の保存に失敗しました: ${messageOf(error)}`);
        }
        if (!saved) panel.setError('設定の保存に失敗しました');
        applyPrefs(next);
      },
      onReset: () => {
        try {
          resetPreferences();
          const next = loadPreferences();
          panel.setError(null);
          applyPrefs(next);
          panel.refresh();
        } catch (error) {
          panel.setError(`初期値への復元に失敗しました: ${messageOf(error)}`);
        }
      },
    });
    onDispose(() => panel.dispose());

    toolbar = createToolbar(options.toolbarEl, {
      onAddChild: () => runOp(() => addChildNode(controller.mind)),
      onAddSibling: () => runOp(() => addSiblingNode(controller.mind)),
      onRemove: () => runOp(() => removeSelected(controller.mind)),
      onToggleExpand: () => withSyncFlip(() => expandToggle(controller.mind)),
      onExpandAll: () => withSyncFlip(() => expandAll(controller.mind, true)),
      onCollapseAll: () => withSyncFlip(() => expandAll(controller.mind, false)),
      onMoveUp: () => runOp(() => moveUp(controller.mind)),
      onMoveDown: () => runOp(() => moveDown(controller.mind)),
      onUndo: () => undo(controller.mind),
      onRedo: () => redo(controller.mind),
      onCenter: () => centerView(controller.mind),
      onFit: () => fitView(controller.mind),
      onNew: () => {
        void handleNew();
      },
      onImport: (file: File) => {
        void handleImport(file);
      },
      onExport: () => handleExport(),
      onOpenSettings: () => panel.setOpen(true),
    });
    onDispose(() => toolbar?.dispose());
    toolbar.setVisible(prefs.toolbarVisible);
    applySelection();
  } catch (error) {
    status.setError(`起動に失敗しました: ${messageOf(error)}`);
  }

  return { dispose };
}
