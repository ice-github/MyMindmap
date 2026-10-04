import { expect, test } from '@playwright/test';
import { TOPICS, cancelEditing, selectFirstTopic, topicCount } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator(TOPICS).first()).toBeVisible({ timeout: 15_000 });
});

test('起動時にノードが描画される', async ({ page }) => {
  expect(await topicCount(page)).toBeGreaterThanOrEqual(1);
});

test('ノード編集中も編集ボックスがノード幅に揃い、エッジと離れない', async ({ page }) => {
  const root = page.locator(TOPICS).filter({ hasText: 'Central Topic' });
  await root.dblclick();
  const editBox = page.locator('#map #input-box');
  await expect(editBox).toBeVisible();

  const dimensions = await page.evaluate(() => {
    const topic = [...document.querySelectorAll<HTMLElement>('#map me-tpc')]
      .find((el) => el.textContent?.trim() === 'Central Topic');
    const input = document.querySelector<HTMLElement>('#map #input-box');
    if (!topic || !input) throw new Error('edit elements not found');
    return {
      nodeWidth: topic.getBoundingClientRect().width,
      inputWidth: input.getBoundingClientRect().width,
    };
  });
  expect(Math.abs(dimensions.nodeWidth - dimensions.inputWidth)).toBeLessThanOrEqual(1);
});

test('Ctrl+矢印でレイアウトを切り替えても選択ノードを維持する', async ({ page }) => {
  await selectFirstTopic(page);
  await page.locator('[data-action="add-child"]').click();
  await cancelEditing(page);
  const child = page.locator(TOPICS).filter({ hasText: 'New Node' }).first();
  await child.click();
  const nodeId = await child.getAttribute('data-nodeid');

  for (const key of ['Control+ArrowLeft', 'Control+ArrowUp', 'Control+ArrowRight']) {
    await page.keyboard.press(key);
    await expect(page.locator(`#map me-tpc[data-nodeid="${nodeId}"]`)).toHaveClass(/selected/);
    await expect(page.locator('[data-action="add-sibling"]')).toBeEnabled();
  }
});

test('左右両側レイアウトではAlt+左右で第1階層の枝を左右に振り分ける', async ({ page }) => {
  await selectFirstTopic(page);
  await page.locator('[data-action="add-child"]').click();
  await cancelEditing(page);
  const child = page.locator(TOPICS).filter({ hasText: 'New Node' }).first();
  await child.click();
  const nodeId = await child.getAttribute('data-nodeid');

  await page.keyboard.press('Control+ArrowUp');
  await expect(page.locator(`#map me-tpc[data-nodeid="${nodeId}"]`)).toHaveClass(/selected/);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(() => page.locator(`#map me-tpc[data-nodeid="${nodeId}"]`)
    .evaluate((node) => node.closest('me-main')?.className)).toBe('lhs');
  await expect(page.locator(`#map me-tpc[data-nodeid="${nodeId}"]`)).toHaveClass(/selected/);

  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(() => page.locator(`#map me-tpc[data-nodeid="${nodeId}"]`)
    .evaluate((node) => node.closest('me-main')?.className)).toBe('rhs');
  await expect(page.locator(`#map me-tpc[data-nodeid="${nodeId}"]`)).toHaveClass(/selected/);
  await expect.poll(() => page.locator(`#map me-tpc[data-nodeid="${nodeId}"]`)
    .evaluate((node) => node.getAnimations().some((animation) => animation.playState === 'running'))).toBe(true);
});

test('Ctrl+Mでキーボード移動モードに入り、Escで安全にキャンセルできる', async ({ page }) => {
  await selectFirstTopic(page);
  await page.locator('[data-action="add-child"]').click();
  await cancelEditing(page);
  const child = page.locator(TOPICS).filter({ hasText: 'New Node' }).first();
  await child.focus();
  await page.keyboard.press('Control+m');
  await expect(page.locator('#map-container')).toHaveAttribute('data-move-mode', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#map-container')).not.toHaveAttribute('data-move-mode');
  await expect(child).toHaveClass(/selected/);
});

test('キーボードだけで選択ノードを別ノードの子に移動できる', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.locator('#toolbar input[type="file"]').setInputFiles({
    name: 'keyboard-move.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      data: {
        direction: 1,
        nodeData: {
          id: 'root', root: true, topic: 'Root',
          children: [
            { id: 'alpha', topic: 'Alpha', direction: 1 },
            { id: 'beta', topic: 'Beta', direction: 1 },
          ],
        },
      },
    })),
  });
  const alpha = page.locator('#map me-tpc').filter({ hasText: 'Alpha' });
  const beta = page.locator('#map me-tpc').filter({ hasText: 'Beta' });
  await expect(alpha).toBeVisible();
  await alpha.click(); // Set the source; all move/navigation input below is keyboard-only.
  await page.keyboard.press('Control+m');
  await expect(page.locator('#map-container')).toHaveAttribute('data-move-mode', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(beta).toHaveClass(/selected/);
  await page.keyboard.press('Enter');
  await expect(page.locator('#map-container')).not.toHaveAttribute('data-move-mode');
  await expect(alpha).toHaveClass(/selected/);
  expect(await beta.evaluate((el) => {
    const children = el.parentElement?.parentElement?.querySelector('me-children');
    return children?.querySelector('me-tpc')?.textContent?.trim() === 'Alpha';
  })).toBe(true);
});

test('移動モードでCentralにShift+Enterしてもマップを壊さない', async ({ page }) => {
  await selectFirstTopic(page);
  await page.locator('[data-action="add-child"]').click();
  await cancelEditing(page);
  await page.locator('#map me-tpc').filter({ hasText: 'New Node' }).click();
  const before = await topicCount(page);
  await page.keyboard.press('Control+m');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#map me-tpc').filter({ hasText: 'Central Topic' })).toHaveClass(/selected/);
  await page.keyboard.press('Shift+Enter');

  await expect(page.locator('#map-container')).toHaveAttribute('data-move-mode', 'true');
  await expect(page.locator('#map me-tpc').filter({ hasText: 'Central Topic' })).toBeVisible();
  expect(await topicCount(page)).toBe(before);
});

test('子を追加ボタンでノード数が増え undo/redo で戻る', async ({ page }) => {
  const addChild = page.locator('button[data-action="add-child"]');
  const undo = page.locator('button[data-action="undo"]');
  const redo = page.locator('button[data-action="redo"]');

  await selectFirstTopic(page);

  const before = await topicCount(page);
  await addChild.click();
  await expect.poll(() => topicCount(page), { timeout: 10_000 }).toBe(before + 1);

  await cancelEditing(page);

  await undo.click();
  await expect.poll(() => topicCount(page), { timeout: 10_000 }).toBe(before);

  await redo.click();
  await expect.poll(() => topicCount(page), { timeout: 10_000 }).toBe(before + 1);
});

test('子ノードを選択して兄弟を追加できる', async ({ page }) => {
  await selectFirstTopic(page);

  const before = await topicCount(page);
  await page.locator('button[data-action="add-child"]').click();
  await expect.poll(() => topicCount(page), { timeout: 10_000 }).toBe(before + 1);
  await cancelEditing(page);

  // 追加された子ノードを選択し直して兄弟を追加する。
  // NOTE: ルートには兄弟を追加できないため、明示的に子ノードを選ぶ。
  await page.locator(TOPICS).filter({ hasText: 'New Node' }).first().click();
  await expect(page.locator('button[data-action="add-sibling"]')).toBeEnabled({
    timeout: 10_000,
  });
  await page.locator('button[data-action="add-sibling"]').click();
  await expect.poll(() => topicCount(page), { timeout: 10_000 }).toBe(before + 2);
  await cancelEditing(page);
});

test('キーボード Tab/Enter でもノード追加時にアニメーションする', async ({ page }) => {
  await selectFirstTopic(page);

  const before = await topicCount(page);
  await page.keyboard.press('Tab');
  await expect.poll(() => topicCount(page), { timeout: 10_000 }).toBe(before + 1);
  // 実際のノード追加処理からアニメーションが開始されることを確認。
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().length), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await cancelEditing(page);

  await page.locator(TOPICS).filter({ hasText: 'New Node' }).first().click();
  await page.keyboard.press('Enter');
  await expect.poll(() => topicCount(page), { timeout: 10_000 }).toBe(before + 2);
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().length), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await cancelEditing(page);
});

test('設定ダイアログで自動保存を外すと手動保存ボタンが現れる', async ({ page }) => {
  const dialog = page.locator('.settings-panel[role="dialog"]');
  await page.locator('button[data-action="settings"]').click();
  await expect(dialog).toBeVisible();

  const autoSave = page.locator('input[data-pref="autoSave"]');
  await expect(autoSave).toBeVisible();
  // 自動保存ONが初期値の前提でOFFにする。既にOFFならそのまま検証する。
  if (await autoSave.isChecked()) {
    await autoSave.uncheck();
  }
  await expect(page.locator('.manual-save')).toBeVisible();
});

test('ツールバー非表示でも設定から復帰できる', async ({ page }) => {
  const toolbar = page.locator('#toolbar');
  const dialog = page.locator('.settings-panel[role="dialog"]');
  await expect(toolbar).toBeVisible();

  await page.locator('button[data-action="settings"]').click();
  await expect(dialog).toBeVisible();

  const toolbarToggle = page.locator('input[data-pref="toolbarVisible"]');
  await toolbarToggle.uncheck();
  await expect(toolbar).toBeHidden();

  // 設定パネル自体は #settings-root 配下なのでツールバー非表示でも操作できる。
  await toolbarToggle.check();
  await expect(toolbar).toBeVisible();
});
