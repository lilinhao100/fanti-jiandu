// M5 验收截图：字体与版式页（浅色、深色）；同一本书 1280×820 下 自动/单栏/双栏；900 宽窗口双栏；行距 1.3 与 2.4。
// 截图存到 screenshots/M5/。书是现场合成的（reading-book.ts）。
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ROOT } from './helpers';
import { openReadingBook } from './reading';

const OUT = path.join(ROOT, 'screenshots', 'M5');

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(700);
}

async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function showToolbar(page: Page): Promise<void> {
  await page.mouse.move(page.viewportSize()!.width / 2, 30);
  await expect(page.getByTestId('toolbar')).toHaveClass(/visible/);
}

async function hideToolbar(page: Page): Promise<void> {
  await page.mouse.move(page.viewportSize()!.width / 2, 420);
  await expect(page.getByTestId('toolbar')).not.toHaveClass(/visible/, { timeout: 4000 });
}

async function openLayoutPage(page: Page): Promise<void> {
  await showToolbar(page);
  await page.getByTestId('appearance-button').click();
  await page.getByTestId('appearance-custom').click();
  await expect(page.getByTestId('appearance-custom-page')).toBeVisible();
}

async function closePanel(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('appearance-panel')).toHaveCount(0);
  await hideToolbar(page);
}

async function turnPages(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(450);
  }
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`M5 截图·字体与版式页·${scheme === 'light' ? '浅色' : '深色'}`, () => {
    test.use({ viewport: { width: 1280, height: 820 }, colorScheme: scheme, deviceScaleFactor: 1 });

    test(`第二页 (${scheme})`, async ({ page }) => {
      fs.mkdirSync(OUT, { recursive: true });
      await openReadingBook(page);
      await turnPages(page, 2);
      await openLayoutPage(page);
      await shot(page, `appearance-layout-${scheme}`);
    });
  });
}

test.describe('M5 截图·栏数', () => {
  test.use({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });

  test('同一本书 1280×820：自动、单栏、双栏', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await openReadingBook(page);
    await turnPages(page, 2);
    await hideToolbar(page);
    await shot(page, 'columns-auto-1280');
    await openLayoutPage(page);
    await page.getByTestId('columns-one').click();
    await closePanel(page);
    await shot(page, 'columns-one-1280');
    await openLayoutPage(page);
    await page.getByTestId('columns-two').click();
    await closePanel(page);
    await shot(page, 'columns-two-1280');
  });

  test('行间距 1.3 与 2.4', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await openReadingBook(page);
    await turnPages(page, 2);
    await openLayoutPage(page);
    await page.getByRole('slider', { name: '行间距' }).fill('1.3');
    await closePanel(page);
    await shot(page, 'line-height-1.3');
    await openLayoutPage(page);
    await page.getByRole('slider', { name: '行间距' }).fill('2.4');
    await closePanel(page);
    await shot(page, 'line-height-2.4');
  });
});

test.describe('M5 截图·900 宽窗口', () => {
  test.use({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });

  test('900×700：自动是单栏，选双栏变两栏', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await openReadingBook(page);
    await turnPages(page, 2);
    await openLayoutPage(page);
    await page.getByTestId('columns-two').click();
    await closePanel(page);
    await shot(page, 'columns-two-900');
  });
});
