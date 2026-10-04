import { expect, type Page } from '@playwright/test';

/** mind-elixir のトピック要素を表すセレクタ。 */
export const TOPICS = '#map me-tpc, #map .topic';

export const topicCount = (page: Page): Promise<number> => page.locator(TOPICS).count();

/**
 * 先頭トピックを選択状態にする。実クリックで行う。
 *
 * mind-elixir の公式CSSが読み込まれている前提で、トピック中央の
 * `span.text` はクリックを透過するため `me-tpc` への通常クリックで選択できる。
 */
export async function selectFirstTopic(page: Page): Promise<void> {
  const first = page.locator(TOPICS).first();
  await first.waitFor({ state: 'visible', timeout: 15_000 });
  await first.click();
  await expect(page.locator('button[data-action="add-child"]')).toBeEnabled({ timeout: 10_000 });
}

/** 編集中（addChild 直後の編集モード等）から抜ける。失敗しても続行する。 */
export async function cancelEditing(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => undefined);
}
