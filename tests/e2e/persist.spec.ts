import { expect, test } from '@playwright/test';
import { TOPICS, cancelEditing, selectFirstTopic, topicCount } from './helpers.js';

// NOTE: 実ブラウザの IndexedDB に保存されるため、リロード復元の検証は
// jsdom ではなく Playwright/Chromium で行う。

test('子追加→リロードでノードが復元される', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(TOPICS).first()).toBeVisible({ timeout: 15_000 });

  await selectFirstTopic(page);

  const before = await topicCount(page);
  await page.locator('button[data-action="add-child"]').click();
  await expect.poll(() => topicCount(page), { timeout: 10_000 }).toBe(before + 1);
  await cancelEditing(page);

  // 自動保存(debounce 400ms + IndexedDB 書き込み)を待つ。
  await expect(page.locator('#status')).toContainText('保存しました', { timeout: 15_000 });

  await page.reload();
  await expect(page.locator(TOPICS).first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => topicCount(page), { timeout: 15_000 }).toBe(before + 1);
});

test('不正JSONのimportでマップが維持される', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(TOPICS).first()).toBeVisible({ timeout: 15_000 });

  // handleImport は先に window.confirm を出すので自動承認する。
  page.on('dialog', (dialog) => void dialog.accept());

  const before = await topicCount(page);
  const fileInput = page.locator('#toolbar input[type="file"]');

  // 1) JSONですらないファイル
  await fileInput.setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('this is not json {{{'),
  });
  await expect(page.locator('#status')).toContainText('読み込みに失敗しました', {
    timeout: 10_000,
  });
  expect(await topicCount(page)).toBe(before);

  // 2) JSONとして成立するがスキーマ不正のファイル
  await fileInput.setInputFiles({
    name: 'wrong-schema.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ foo: 1 })),
  });
  await expect(page.locator('#status')).toContainText('読み込みに失敗しました', {
    timeout: 10_000,
  });
  expect(await topicCount(page)).toBe(before);
});
