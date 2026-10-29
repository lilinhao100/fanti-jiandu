import { expect, test } from '@playwright/test';
import { buildReadingBook } from './reading-book';
import {
  bookPath,
  currentLocation,
  expectLocationChange,
  gotoSection,
  importBooks,
  openCard,
  waitForCards,
} from './helpers';

test.describe('阅读窗口的交互（用小书，快）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await importBooks(page, [bookPath('tw-vertical.epub')]); // 80 段，分好几页
    await waitForCards(page, 1);
    await openCard(page, /打开《/);
  });

  test('工具栏：指针进入顶部才出现，离开 1.2 秒后隐藏；有面板开着不隐藏', async ({ page }) => {
    const bar = page.getByTestId('toolbar');
    await expect(bar).not.toHaveClass(/visible/);
    await page.mouse.move(640, 30);
    await expect(bar).toHaveClass(/visible/);
    await page.mouse.move(640, 400);
    await page.waitForTimeout(600);
    await expect(bar).toHaveClass(/visible/); // 还没到 1.2 秒
    await expect(bar).not.toHaveClass(/visible/, { timeout: 3000 });

    await page.keyboard.press('Control+t'); // 目录
    await expect(page.getByTestId('toc-panel')).toBeVisible();
    await expect(bar).toHaveClass(/visible/);
    await page.mouse.move(640, 400);
    await page.waitForTimeout(1800);
    await expect(bar).toHaveClass(/visible/); // 面板开着不隐藏
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('toc-panel')).toHaveCount(0);
    await expect(bar).not.toHaveClass(/visible/, { timeout: 3000 });

    // Alt 键也能唤出工具栏
    await page.keyboard.press('Alt');
    await expect(bar).toHaveClass(/visible/);
  });

  test('指针靠近左右边缘 80px 内出现翻页箭头，点击翻页', async ({ page }) => {
    const right = page.getByRole('button', { name: '下一页' });
    await expect(right).not.toHaveClass(/visible/);
    await page.mouse.move(1250, 400);
    await expect(right).toHaveClass(/visible/);
    await expectLocationChange(page, () => right.click());
    const left = page.getByRole('button', { name: '上一页' });
    await page.mouse.move(30, 400);
    await expect(left).toHaveClass(/visible/);
    await expectLocationChange(page, () => left.click());
  });

  test('页脚：位置与本章剩余页数随翻页变化', async ({ page }) => {
    const left = page.getByTestId('pages-left');
    await expect(left).toHaveText(/^本章还剩 \d+ 页$/);
    const n0 = Number((await left.textContent())!.match(/\d+/)![0]);
    await expectLocationChange(page, () => page.keyboard.press('ArrowRight'));
    await expect(left).toHaveText(`本章还剩 ${n0 - 1} 页`);
  });

  test('Alt+→ / Alt+← 切换章节（只有一章时不报错）', async ({ page }) => {
    await page.keyboard.press('Alt+ArrowRight');
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.getByTestId('reader')).toHaveAttribute('data-status', 'ready');
  });

  test('目录点击后“返回”按钮出现，点它回到跳转前的位置', async ({ page }) => {
    await expectLocationChange(page, () => page.keyboard.press('ArrowRight'));
    await expectLocationChange(page, () => page.keyboard.press('ArrowRight'));
    const before = await currentLocation(page);
    await page.keyboard.press('Control+t');
    await page.getByTestId('toc-panel').locator('.toc-item').first().click();
    await expect.poll(async () => (await currentLocation(page))?.cfi).not.toBe(before!.cfi);
    const back = page.getByRole('button', { name: '返回', exact: true });
    await expect(back).toBeVisible();
    await back.click();
    await expect.poll(async () => (await currentLocation(page))?.cfi).toBe(before!.cfi);
  });
});

test.describe('阅读窗口的健壮性', () => {
  test('地址里的书不存在：显示错误并能回到书库', async ({ page }) => {
    await page.goto('/#/reader/0000000000000000');
    await expect(page.getByTestId('reader-error')).toContainText('书库里没有这本书');
    await page.getByRole('button', { name: '返回书库' }).last().click();
    await expect(page.getByTestId('library')).toBeVisible();
  });

  test('窗口宽度跨过 1000px：双页与单页之间切换，位置不丢', async ({ page }) => {
    await page.goto('/');
    await importBooks(page, [bookPath('tw-vertical.epub')]);
    await waitForCards(page, 1);
    await openCard(page, /打开《/);
    await expectLocationChange(page, () => page.keyboard.press('ArrowRight'));
    const before = await currentLocation(page);
    await page.setViewportSize({ width: 800, height: 700 });
    await page.waitForTimeout(600);
    const narrow = await currentLocation(page);
    expect(Math.abs(narrow!.fraction - before!.fraction)).toBeLessThan(0.2);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(600);
    await expect(page.getByTestId('reader')).toHaveAttribute('data-status', 'ready');
  });
});

test.describe('缓存与存储（合成的 PDF 转制书）', () => {
  test('首次打开检测的结果缓存进 BookRecord：繁体、PDF 转制；进度 debounce 1 秒后写入', async ({ page }) => {
    await page.goto('/');
    await importBooks(page, [{ name: 'reflow.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(buildReadingBook(14, 'PDF Reflow conversion')) }]);
    await waitForCards(page, 1);

    const readRecord = (): Promise<Record<string, unknown>> =>
      page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const req = indexedDB.open('fjd');
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
              const all = req.result.transaction('books').objectStore('books').getAll();
              all.onsuccess = () => resolve(all.result[0]);
            };
          }),
      );

    const fresh = await readRecord();
    expect(fresh.script).toBeUndefined(); // 导入时不检测
    expect(fresh.pdfReflow).toBeUndefined();

    await openCard(page, /江南旧事/);
    await expect.poll(async () => (await readRecord()).pdfReflow).toBe(true);
    const rec = await readRecord();
    expect(rec.script).toMatchObject({ script: 'hant', variant: 'tw' });
    expect(rec.lastOpenedAt).toBeGreaterThan(0);

    // 进度：翻页后 1 秒内不写盘，之后写入
    await gotoSection(page, 5);
    const t0 = Date.now();
    await expectLocationChange(page, () => page.keyboard.press('ArrowRight'));
    const target = (await currentLocation(page))!.cfi;
    await expect.poll(async () => ((await readRecord()).progress as { cfi: string } | undefined)?.cfi, { timeout: 5000 }).toBe(target);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  });
});
