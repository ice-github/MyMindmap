export type ToolbarActionHandler = () => void;

export type ToolbarActions = {
  onAddChild: ToolbarActionHandler;
  onAddSibling: ToolbarActionHandler;
  onRemove: ToolbarActionHandler;
  onToggleExpand: ToolbarActionHandler;
  onExpandAll: ToolbarActionHandler;
  onCollapseAll: ToolbarActionHandler;
  onMoveUp: ToolbarActionHandler;
  onMoveDown: ToolbarActionHandler;
  onUndo: ToolbarActionHandler;
  onRedo: ToolbarActionHandler;
  onCenter: ToolbarActionHandler;
  onFit: ToolbarActionHandler;
  onNew: ToolbarActionHandler;
  onImport: (file: File) => void;
  onExport: ToolbarActionHandler;
  onOpenSettings: ToolbarActionHandler;
};

export type ToolbarState = {
  hasSelection: boolean;
  isRoot: boolean;
  canEdit: boolean;
};

export type ToolbarController = {
  setToolbarState: (state: ToolbarState) => void;
  setVisible: (visible: boolean) => void;
  dispose: () => void;
};

type ButtonDef = {
  action: string;
  label: string;
  title: string;
  run: () => void;
  requiresEdit: boolean;
  requiresSelection: boolean;
  disabledForRoot: boolean;
};

export function createToolbar(root: HTMLElement, actions: ToolbarActions): ToolbarController {
  const aborter = new AbortController();
  const signal = aborter.signal;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json';
  fileInput.hidden = true;
  fileInput.tabIndex = -1;
  fileInput.setAttribute('aria-hidden', 'true');
  fileInput.addEventListener(
    'change',
    () => {
      const file = fileInput.files?.item(0) ?? null;
      fileInput.value = '';
      if (file) actions.onImport(file);
    },
    { signal },
  );

  const defs: ButtonDef[] = [
    { action: 'add-child', label: '子を追加', title: '子ノードを追加する (Tab)', run: actions.onAddChild, requiresEdit: true, requiresSelection: true, disabledForRoot: false },
    { action: 'add-sibling', label: '兄弟を追加', title: '兄弟ノードを追加する (Enter)', run: actions.onAddSibling, requiresEdit: true, requiresSelection: true, disabledForRoot: true },
    { action: 'remove', label: '削除', title: '選択したノードを削除する (Delete)', run: actions.onRemove, requiresEdit: true, requiresSelection: true, disabledForRoot: true },
    { action: 'toggle-expand', label: '展開切替', title: '選択したノードの展開/折りたたみを切り替える (Space)', run: actions.onToggleExpand, requiresEdit: false, requiresSelection: true, disabledForRoot: false },
    { action: 'expand-all', label: '全て展開', title: 'すべてのノードを展開する', run: actions.onExpandAll, requiresEdit: false, requiresSelection: false, disabledForRoot: false },
    { action: 'collapse-all', label: '全て折畳', title: 'すべてのノードを折りたたむ', run: actions.onCollapseAll, requiresEdit: false, requiresSelection: false, disabledForRoot: false },
    { action: 'move-up', label: '上へ', title: '選択したノードを上へ移動する', run: actions.onMoveUp, requiresEdit: true, requiresSelection: true, disabledForRoot: true },
    { action: 'move-down', label: '下へ', title: '選択したノードを下へ移動する', run: actions.onMoveDown, requiresEdit: true, requiresSelection: true, disabledForRoot: true },
    { action: 'undo', label: '元に戻す', title: '元に戻す (Ctrl+Z)', run: actions.onUndo, requiresEdit: true, requiresSelection: false, disabledForRoot: false },
    { action: 'redo', label: 'やり直し', title: 'やり直し (Ctrl+Y)', run: actions.onRedo, requiresEdit: true, requiresSelection: false, disabledForRoot: false },
    { action: 'center', label: '中央表示', title: '選択中のノードを中央に表示する', run: actions.onCenter, requiresEdit: false, requiresSelection: false, disabledForRoot: false },
    { action: 'fit', label: '全体表示', title: '全体が収まるように表示する', run: actions.onFit, requiresEdit: false, requiresSelection: false, disabledForRoot: false },
    { action: 'new', label: '新規', title: '新規マインドマップを作成する', run: actions.onNew, requiresEdit: true, requiresSelection: false, disabledForRoot: false },
    { action: 'import', label: '読込', title: 'JSONファイルを読み込む', run: () => fileInput.click(), requiresEdit: true, requiresSelection: false, disabledForRoot: false },
    { action: 'export', label: '書出', title: 'JSONファイルに書き出す', run: actions.onExport, requiresEdit: false, requiresSelection: false, disabledForRoot: false },
    { action: 'settings', label: '設定', title: '設定を開く', run: actions.onOpenSettings, requiresEdit: false, requiresSelection: false, disabledForRoot: false },
  ];

  const buttons = new Map<string, HTMLButtonElement>();
  for (const def of defs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = def.action;
    button.textContent = def.label;
    button.title = def.title;
    button.addEventListener('click', () => def.run(), { signal });
    root.appendChild(button);
    buttons.set(def.action, button);
  }
  root.appendChild(fileInput);

  let state: ToolbarState = { hasSelection: false, isRoot: true, canEdit: true };

  const refreshDisabled = (): void => {
    for (const def of defs) {
      const button = buttons.get(def.action);
      if (!button) continue;
      button.disabled =
        (def.requiresEdit && !state.canEdit) ||
        (def.requiresSelection && !state.hasSelection) ||
        (def.disabledForRoot && (!state.hasSelection || state.isRoot));
    }
  };
  refreshDisabled();

  return {
    setToolbarState(next: ToolbarState): void {
      state = { hasSelection: next.hasSelection, isRoot: next.isRoot, canEdit: next.canEdit };
      refreshDisabled();
    },
    setVisible(visible: boolean): void {
      root.hidden = !visible;
    },
    dispose(): void {
      aborter.abort();
      root.replaceChildren();
    },
  };
}
