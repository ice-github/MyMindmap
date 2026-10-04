import { expect, test, type Page } from '@playwright/test';
import { TOPICS, cancelEditing, selectFirstTopic, topicCount } from './helpers.js';

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

async function edgeAnimationCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const state = window as unknown as {
      observedAnimations: Array<{ target: string; frames: Keyframe[] }>;
    };
    return state.observedAnimations.filter(
      ({ target, frames }) => target === 'path' && frames.some((frame) => 'strokeDashoffset' in frame),
    ).length;
  });
}

test('Tab/Enterでノードとエッジがともに登場し、線の一時スタイルが残らない', async ({ page }) => {
  await observeAnimations(page);
  await page.goto('/');
  await selectFirstTopic(page);
  await page.keyboard.press('Tab');
  await expect.poll(() => topicCount(page)).toBe(2);
  await expect.poll(() => edgeAnimationCount(page)).toBe(1);
  await expect.poll(() => page.evaluate(() => {
    const state = window as unknown as {
      observedAnimations: Array<{ target: string; frames: Keyframe[] }>;
    };
    return state.observedAnimations.some(({ target, frames }) =>
      target === 'me-tpc' && frames.some((frame) => frame.opacity === '0'),
    );
  })).toBe(true);
  await expect.poll(() => page.evaluate(() =>
    [...document.querySelectorAll<SVGPathElement>('#map svg.lines path, #map svg.subLines path')]
      .every((path) => path.style.strokeDasharray === '' && path.style.strokeDashoffset === ''),
  )).toBe(true);

  await cancelEditing(page);
  await page.locator(TOPICS).filter({ hasText: 'New Node' }).first().click();
  const before = await edgeAnimationCount(page);
  await page.keyboard.press('Enter');
  await expect.poll(() => topicCount(page)).toBe(3);
  await expect.poll(() => edgeAnimationCount(page)).toBeGreaterThan(before);
});

test('エッジ描画効果はGUIで独立して無効にできる', async ({ page }) => {
  await observeAnimations(page);
  await page.goto('/');
  await page.locator('[data-action="settings"]').click();
  await page.locator('[data-pref="edgeEffect"]').uncheck();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await selectFirstTopic(page);
  await page.keyboard.press('Tab');
  await expect.poll(() => topicCount(page)).toBe(2);
  expect(await edgeAnimationCount(page)).toBe(0);
});

test('Reduced Motionではエッジも即時反映する', async ({ page }) => {
  await observeAnimations(page);
  await page.goto('/');
  await selectFirstTopic(page);
  // OS設定の動的変更も反映されることを、ノード追加前に検証する。
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Tab');
  await expect.poll(() => topicCount(page)).toBe(2);
  expect(await edgeAnimationCount(page)).toBe(0);
  await expect(page.locator('#map svg.lines path')).toHaveCount(1);
});

test('孫ノードの接続も描画され、既存エッジは再描画演出しない', async ({ page }) => {
  await observeAnimations(page);
  await page.goto('/');
  await selectFirstTopic(page);
  await page.keyboard.press('Tab');
  await expect.poll(() => topicCount(page)).toBe(2);
  await expect.poll(() => edgeAnimationCount(page)).toBe(1);
  await cancelEditing(page);
  await page.locator(TOPICS).filter({ hasText: 'New Node' }).first().click();
  const before = await edgeAnimationCount(page);
  await page.keyboard.press('Tab');
  await expect.poll(() => topicCount(page)).toBe(3);
  await expect.poll(() => edgeAnimationCount(page)).toBe(before + 1);
  await expect(page.locator('#map svg.subLines path')).toHaveCount(1);
});
