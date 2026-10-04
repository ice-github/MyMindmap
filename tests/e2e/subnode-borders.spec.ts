import { expect, test, type Page } from '@playwright/test';
import { TOPICS } from './helpers.js';

async function importNestedFixture(page: Page): Promise<void> {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.locator('#toolbar input[type="file"]').setInputFiles({
    name: 'subnode-borders-fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      data: {
        nodeData: {
          id: 'root',
          root: true,
          topic: 'Root',
          children: [{
            id: 'parent',
            topic: 'Parent',
            direction: 1,
            children: [{
              id: 'grandchild',
              topic: 'Grandchild',
              children: [{ id: 'great-grandchild', topic: 'GreatGrandchild' }],
            }],
          }],
        },
        direction: 1,
      },
    })),
  });
  await expect(topic(page, 'GreatGrandchild')).toBeVisible();
}

function topic(page: Page, name: string) {
  return page.locator(TOPICS).filter({ hasText: new RegExp(`^${name}$`) });
}

async function topicStyle(page: Page, name: string) {
  return topic(page, name).evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      boxShadow: style.boxShadow,
      borderRadius: style.borderRadius,
      outline: style.outline,
      width: rect.width,
      height: rect.height,
    };
  });
}

async function geometry(page: Page) {
  return page.evaluate(() => ({
    topics: [...document.querySelectorAll<HTMLElement>('#map me-tpc, #map .topic')].map((element) => {
      const rect = element.getBoundingClientRect();
      return [element.textContent?.trim(), rect.x, rect.y, rect.width, rect.height];
    }),
    edges: [...document.querySelectorAll<SVGPathElement>(
      '#map svg.lines path, #map svg.subLines path',
    )].map((path) => path.getAttribute('d')),
  }));
}

async function setSubnodeBorders(page: Page, enabled: boolean): Promise<void> {
  await page.locator('[data-action="settings"]').click();
  const checkbox = page.locator('[data-pref="subnodeBorders"]');
  if (enabled) await checkbox.check();
  else await checkbox.uncheck();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('#map')).toHaveClass(enabled ? /subnode-borders/ : /(?!.*subnode-borders)/);
}

test('下位ノードの枠は階層にだけ適用され、レイアウト・選択・設定を維持する', async ({ page }) => {
  await page.goto('/');
  await importNestedFixture(page);

  const map = page.locator('#map');
  await expect(map).toHaveClass(/subnode-borders/);
  for (const name of ['Grandchild', 'GreatGrandchild']) {
    const style = await topicStyle(page, name);
    expect(style.boxShadow).toContain('inset');
    expect(style.boxShadow).toContain('1px');
    expect(style.borderRadius).toBe('4px');
  }

  const rootBefore = await topicStyle(page, 'Root');
  const parentBefore = await topicStyle(page, 'Parent');
  expect(rootBefore.boxShadow).not.toContain('inset');
  expect(parentBefore.boxShadow).not.toContain('inset');
  const geometryOn = await geometry(page);

  const grandchild = topic(page, 'Grandchild');
  await grandchild.click();
  const selectedOutline = await grandchild.evaluate((element) => getComputedStyle(element).outline);
  await setSubnodeBorders(page, false);
  await expect(map).not.toHaveClass(/subnode-borders/);
  expect((await topicStyle(page, 'Grandchild')).boxShadow).not.toContain('inset');
  expect(await topicStyle(page, 'Root')).toEqual(rootBefore);
  expect(await topicStyle(page, 'Parent')).toEqual(parentBefore);
  expect(await geometry(page)).toEqual(geometryOn);
  expect(await grandchild.evaluate((element) => getComputedStyle(element).outline)).toBe(selectedOutline);

  await page.reload();
  await expect(topic(page, 'GreatGrandchild')).toBeVisible();
  await expect(page.locator('#map')).not.toHaveClass(/subnode-borders/);
  expect((await topicStyle(page, 'GreatGrandchild')).boxShadow).not.toContain('inset');
  const geometryAfterReloadOff = await geometry(page);

  await setSubnodeBorders(page, true);
  expect((await topicStyle(page, 'Grandchild')).boxShadow).toContain('inset');
  expect((await topicStyle(page, 'GreatGrandchild')).boxShadow).toContain('inset');
  expect(await geometry(page)).toEqual(geometryAfterReloadOff);
});
