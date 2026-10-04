import type { Preferences } from '../storage/preferences.js';

export type SettingsPanelOptions = {
  get: () => Preferences;
  onChange: (prefs: Preferences) => void;
  onReset: () => void;
};

export type SettingsPanel = {
  setOpen: (open: boolean) => void;
  isOpen: () => boolean;
  refresh: () => void;
  setError: (message: string | null) => void;
  dispose: () => void;
};

type ItemDef = {
  key: keyof Preferences;
  label: string;
};

const ITEMS: ItemDef[] = [
  { key: 'animationEnabled', label: 'アニメーション' },
  { key: 'appearEffect', label: 'ノード登場効果' },
  { key: 'edgeEffect', label: 'エッジ描画効果' },
  { key: 'dimExistingEdges', label: '移動中の既存エッジを薄くする' },
  { key: 'flipEnabled', label: 'レイアウト移動' },
  { key: 'focusPulse', label: 'フォーカス強調' },
  { key: 'subnodeBorders', label: '下位ノードの枠' },
  { key: 'autoSave', label: '自動保存' },
  { key: 'editable', label: '編集を許可' },
  { key: 'dragEnabled', label: 'ドラッグ移動' },
  { key: 'shortcutsEnabled', label: '編集ショートカット' },
  { key: 'contextMenuEnabled', label: '右クリックメニュー' },
  { key: 'toolbarVisible', label: '編集ツールバー表示' },
];

const ANIMATION_CHILDREN: ReadonlySet<keyof Preferences> = new Set([
  'appearEffect',
  'edgeEffect',
  'dimExistingEdges',
  'flipEnabled',
  'focusPulse',
]);

const EDIT_CHILDREN: ReadonlySet<keyof Preferences> = new Set([
  'dragEnabled',
  'shortcutsEnabled',
  'contextMenuEnabled',
]);

function isDisabled(key: keyof Preferences, prefs: Preferences): boolean {
  if (key === 'dimExistingEdges') return !prefs.animationEnabled || !prefs.flipEnabled;
  if (ANIMATION_CHILDREN.has(key)) return !prefs.animationEnabled;
  if (EDIT_CHILDREN.has(key)) return !prefs.editable;
  return false;
}

export function createSettingsPanel(root: HTMLElement, options: SettingsPanelOptions): SettingsPanel {
  const panel = document.createElement('div');
  panel.className = 'settings-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '表示と編集の設定');
  panel.hidden = true;

  const heading = document.createElement('h2');
  heading.textContent = '設定';
  panel.appendChild(heading);

  const inputs = new Map<keyof Preferences, HTMLInputElement>();
  for (const item of ITEMS) {
    const row = document.createElement('label');
    row.className = 'settings-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.pref = item.key;
    const text = document.createElement('span');
    text.textContent = item.label;
    row.append(input, text);
    panel.appendChild(row);
    inputs.set(item.key, input);
    input.addEventListener('change', () => {
      const next: Preferences = { ...options.get() };
      next[item.key] = input.checked;
      options.onChange(next);
      refresh();
    });
  }

  const errorElement = document.createElement('p');
  errorElement.className = 'settings-error';
  errorElement.setAttribute('aria-live', 'polite');
  panel.appendChild(errorElement);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'settings-actions';

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = '初期値に戻す';
  resetButton.addEventListener('click', () => options.onReset());

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '閉じる';
  closeButton.addEventListener('click', () => setOpen(false));

  actionsRow.append(resetButton, closeButton);
  panel.appendChild(actionsRow);
  root.appendChild(panel);

  let opener: Element | null = null;

  function refresh(): void {
    const prefs = options.get();
    for (const item of ITEMS) {
      const input = inputs.get(item.key);
      if (!input) continue;
      input.checked = prefs[item.key];
      input.disabled = isDisabled(item.key, prefs);
    }
  }

  function setOpen(open: boolean): void {
    if (open) {
      opener = document.activeElement;
      panel.hidden = false;
      refresh();
      closeButton.focus();
    } else {
      panel.hidden = true;
      if (opener instanceof HTMLElement && document.contains(opener)) {
        opener.focus();
      }
      opener = null;
    }
  }

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setOpen(false);
  });

  refresh();

  return {
    setOpen,
    isOpen: () => !panel.hidden,
    refresh,
    setError: (message: string | null): void => {
      errorElement.textContent = message ?? '';
    },
    dispose: (): void => {
      panel.remove();
      inputs.clear();
    },
  };
}
