import 'mind-elixir/style.css';
import './styles.css';
import { createApp } from './app/app.js';

function reportFailure(message: string): void {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = message;
    return;
  }
  document.body.textContent = message;
}

async function main(): Promise<void> {
  const mapContainer = document.getElementById('map');
  const toolbarEl = document.getElementById('toolbar');
  const statusEl = document.getElementById('status');
  const settingsRoot = document.getElementById('settings-root');

  if (
    !(mapContainer instanceof HTMLElement) ||
    !(toolbarEl instanceof HTMLElement) ||
    !(statusEl instanceof HTMLElement) ||
    !(settingsRoot instanceof HTMLElement)
  ) {
    reportFailure('起動に失敗しました: 必要な要素が見つかりません');
    return;
  }

  try {
    await createApp({ mapContainer, toolbarEl, statusEl, settingsRoot });
  } catch (error) {
    reportFailure(`起動に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
}

void main();
