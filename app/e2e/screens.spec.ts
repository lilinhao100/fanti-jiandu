// M2a 验收截图：窗口 1144×860，浅色、深色各一套。截图存到 screenshots/M2a/。
// 书都是现场合成的（seed.ts、epubs.ts），封面在浏览器里画，所以不依赖 samples/。
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { patchBook, ROOT, waitForCards } from './helpers';
import { seedLibrary } from './seed';

const OUT = path.join(ROOT, 'screenshots', 'M2a');

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(1100, 700);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => {})));
  });
  await page.waitForTimeout(350); // 动画和封面平均色
}

async function shot(page: Page, name: string, scheme: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: path.join(OUT, `${name}-${scheme}.png`) });
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`验收截图·${scheme === 'light' ? '浅色' : '深色'}`, () => {
    test.use({ viewport: { width: 1144, height: 860 }, colorScheme: scheme, deviceScaleFactor: 1 });

    test(`书库、列表、主页、空书库、设置 (${scheme})`, async ({ page }) => {
      fs.mkdirSync(OUT, { recursive: true });
      await page.goto('/');

      // 空书库
      await expect(page.getByTestId('empty-library')).toBeVisible();
      await shot(page, 'empty', scheme);

      // 拖入文件时的虚线框
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.items.add(new File(['x'], 'a.epub'));
        window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
      await expect(page.getByTestId('drop-overlay')).toBeVisible();
      await shot(page, 'drop', scheme);
      await page.evaluate(() => window.dispatchEvent(new DragEvent('dragleave', { bubbles: true })));

      await seedLibrary(page);
      // 造一点读书状态：读到一半的、读完的；其余保持“新增”
      // （打开时间往后推，保证它们排在最前面，截图顺序固定）
      const t = Date.now() + 60_000;
      await patchBook(page, '星圖', { lastOpenedAt: t + 4000, progress: { cfi: 'x', fraction: 0.18, updatedAt: 1 } });
      await patchBook(page, '風信子', { lastOpenedAt: t + 3000, progress: { cfi: 'x', fraction: 1, updatedAt: 1 } });
      await patchBook(page, '舊鐘樓', { lastOpenedAt: t + 2000, progress: { cfi: 'x', fraction: 0.62, updatedAt: 1 } });
      await patchBook(page, '雲端漫步', { lastOpenedAt: t + 1000, progress: { cfi: 'x', fraction: 0.35, updatedAt: 1 } });
      await page.reload();
      await waitForCards(page, 9);

      // 书库·网格（默认“最近阅读”排序：读过的在前，其余按添加时间）
      await shot(page, 'library-grid', scheme);

      // “更多”菜单
      await page.getByTestId('more-button').click();
      await expect(page.getByRole('menu')).toBeVisible();
      await page.getByRole('menuitem', { name: /添加图书/ }).hover();
      await shot(page, 'menu-more', scheme);
      await page.keyboard.press('Escape');

      // 封面下方的“…”菜单
      await page.getByTestId('book-card').nth(1).getByRole('button', { name: '更多' }).click();
      await shot(page, 'menu-card', scheme);
      await page.getByRole('menuitem', { name: /从书库移除/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await shot(page, 'remove-dialog', scheme);
      await page.getByRole('button', { name: '取消' }).click();

      // 列表视图
      await page.getByTestId('more-button').click();
      await page.getByRole('menuitemradio', { name: '列表' }).click();
      await expect(page.getByTestId('book-row')).toHaveCount(9);
      await shot(page, 'library-list', scheme);
      await page.getByTestId('more-button').click();
      await page.getByRole('menuitemradio', { name: '网格' }).click();

      // 主页
      await page.getByTestId('nav-home').click();
      await expect(page.getByTestId('continue-card')).toHaveCount(3);
      await shot(page, 'home', scheme);

      // 设置
      await page.getByTestId('nav-all').click();
      await page.getByTestId('nav-settings').click();
      await expect(page.getByTestId('settings')).toBeVisible();
      await shot(page, 'settings', scheme);
      await page.getByRole('button', { name: '阅读' }).click();
      await shot(page, 'settings-reading', scheme);
      await page.getByRole('button', { name: '关于' }).click();
      await shot(page, 'settings-about', scheme);
      await page.keyboard.press('Escape');

      // 最小窗口 760×520
      await page.setViewportSize({ width: 760, height: 520 });
      await page.waitForTimeout(200);
      await shot(page, 'library-min-size', scheme);
    });
  });
}
