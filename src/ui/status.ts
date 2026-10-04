export type SavingState = 'dirty' | 'saving' | 'saved' | 'error' | string;

export type StatusController = {
  setSaving: (state: SavingState) => void;
  setError: (message: string | null) => void;
  clear: () => void;
};

const SAVING_TEXT: Record<string, string> = {
  dirty: '未保存の変更があります',
  saving: '保存中…',
  saved: '保存しました',
  error: '保存に失敗しました',
};

export function createStatus(element: HTMLElement): StatusController {
  let savingText = '';
  let errorText: string | null = null;

  const render = (): void => {
    const parts: string[] = [];
    if (savingText !== '') parts.push(savingText);
    if (errorText !== null && errorText !== '') parts.push(errorText);
    element.textContent = parts.join(' / ');
  };

  return {
    setSaving(state: SavingState): void {
      if (state === '') {
        savingText = '';
      } else if (Object.hasOwn(SAVING_TEXT, state)) {
        savingText = SAVING_TEXT[state];
      } else {
        savingText = state;
      }
      render();
    },
    setError(message: string | null): void {
      errorText = message;
      render();
    },
    clear(): void {
      savingText = '';
      errorText = null;
      render();
    },
  };
}
