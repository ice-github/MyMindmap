import { expect, test, type Page } from '@playwright/test';
import { TOPICS, cancelEditing, topicCount } from './helpers.js';

async function observeAnimations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Observed = { target: string; frames: PropertyIndexedKeyframes | Keyframe[] | null };
    const state = window as unknown as { observedAnimations: Observed[] };
    state.observedAnimations = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      state.observedAnimations.push({ target: this.tagName.toLowerCase(), frames });
      return original.call(this, frames, options);
    };
  });
}

async function importFixture(page: Page): Promise<void> {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.locator('#toolbar input[type="file"]').setInputFiles({
    name: 'edge-dimming-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      data: {
        nodeData: {
          id: 'root',
          root: true,
          topic: 'Root',
          children: [
            { id: 'first', topic: 'First', direction: 1 },
            { id: 'second', topic: 'Second', direction: 1 },
          ],
        },
        direction: 1,
      },
    })),
  });
  await expect(page.locator(TOPICS).filter({ hasText: 'First' })).toBeVisible();
  await expect(page.locator(TOPICS).filter({ hasText: 'Second' })).toBeVisible();
}

async function addSibling(page: Page): Promise<void> {
  await page.locator(TOPICS).filter({ hasText: 'First' }).click();
  await page.keyboard.press('Enter');
  await expect.poll(() => topicCount(page)).toBe(4);
}

async function observedFrames(page: Page): Promise<Array<{ target: string; frames: Keyframe[] }>> {
  return page.evaluate(() => {
    const state = window as unknown as {
      observedAnimations: Array<{ target: string; frames: Keyframe[] }>;
    };
    return state.observedAnimations;
  });
}

test('既存エッジをFLIP中だけ薄くし、新規エッジ描画は維持する', async ({ page }) => {
  await observeAnimations(page);
  await page.goto('/');
  await importFixture(page);
  await addSibling(page);

  const animations = await observedFrames(page);
  const dimmedEdges = animations.filter(({ target, frames }) =>
    target === 'path' && frames.some((frame) => frame.opacity === 0.25 || frame.opacity === '0.25'),
  );
  expect(dimmedEdges).toHaveLength(2);
  expect(dimmedEdges.every(({ frames }) =>
    frames.some((frame) => frame.opacity === 1 || frame.opacity === '1'),
  )).toBe(true);
  expect(animations.some(({ target, frames }) =>
    target === 'path' && frames.some((frame) => 'strokeDashoffset' in frame),
  )).toBe(true);

  // Sample the held phase deterministically instead of asserting wall-clock frames.
  const heldOpacities = await page.evaluate(() => {
    const values: string[] = [];
    for (const path of document.querySelectorAll<SVGPathElement>('#map svg.lines path, #map svg.subLines path')) {
      const dim = path.getAnimations().find((animation) =>
        (animation.effect as KeyframeEffect).getKeyframes()[0]?.opacity === '0.25');
      if (!dim) continue;
      dim.pause();
      dim.currentTime = 0;
      values.push(getComputedStyle(path).opacity);
      dim.play();
    }
    return values;
  });
  expect(heldOpacities).toEqual(['0.25', '0.25']);

  // Native effects must finish with the original computed opacity, not only
  // leave inline styles untouched while a dim animation is still running.
  await expect.poll(() => page.locator('#map svg.lines path, #map svg.subLines path').evaluateAll(
    (paths) => paths.every((path) => getComputedStyle(path).opacity === '1'),
  ), { timeout: 5_000 }).toBe(true);
});

test('既存エッジの薄化はGUIで無効化できる', async ({ page }) => {
  await observeAnimations(page);
  await page.goto('/');
  await importFixture(page);
  await page.locator('[data-action="settings"]').click();
  await page.locator('[data-pref="dimExistingEdges"]').uncheck();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();

  await addSibling(page);
  const animations = await observedFrames(page);
  expect(animations.some(({ target, frames }) =>
    target === 'path' && frames.some((frame) => frame.opacity === 0.25 || frame.opacity === '0.25'),
  )).toBe(false);
  expect(animations.some(({ target, frames }) =>
    target === 'path' && frames.some((frame) => 'strokeDashoffset' in frame),
  )).toBe(true);
  // Confirm the tree remains interactive after this operation.
  await cancelEditing(page);
  await page.locator(TOPICS).filter({ hasText: 'Second' }).click();
  await expect(page.locator('button[data-action="add-child"]')).toBeEnabled();
});
