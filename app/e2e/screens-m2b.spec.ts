// M2b 验收截图：阅读窗口，1144×860（双页）和 800×860（单页）两种尺寸，浅色、深色各一套。
// 截图存到 screenshots/M2b/。书是现场合成的（reading-book.ts）。
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ROOT } from './helpers';
import { openReadingBook } from './reading';

const OUT = path.join(ROOT, 'screenshots', 'M2b');

const SIZES = [
  { tag: 'w1144', width: 1144, height: 860 },
  { tag: 'w800', width: 800, height: 860 },
] as const;

const THEMES = ['original', 'quiet', 'paper', 'bold', 'calm', 'focus'] as const;

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(450); // 动画、重排
}

async function shot(page: Page, name: string, tag: string, scheme: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: path.join(OUT, `${name}-${tag}-${scheme}.png`) });
}

async function showToolbar(page: Page): Promise<void> {
  await page.mouse.move(page.viewportSize()!.width / 2, 30);
  await expect(page.getByTestId('toolbar')).toHaveClass(/visible/);
}

async function hideToolbar(page: Page): Promise<void> {
  await page.mouse.move(page.viewportSize()!.width / 2, 420);
  await expect(page.getByTestId('toolbar')).not.toHaveClass(/visible/, { timeout: 4000 });
}

for (const size of SIZES) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`验收截图·阅读窗口·${size.tag}·${scheme === 'light' ? '浅色' : '深色'}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, deviceScaleFactor: 1 });

      test(`阅读页、主题、面板 (${size.tag} ${scheme})`, async ({ page }) => {
        fs.mkdirSync(OUT, { recursive: true });
        await openReadingBook(page);
        // 翻几页，让页脚有位置、本章剩余页数
        for (let i = 0; i < 2; i++) {
          await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(450);
        }

        // 工具栏显示时的阅读页（双页或单页，由窗口宽度决定）
        await showToolbar(page);
        await shot(page, 'reader-toolbar', size.tag, scheme);

        // 指针靠近右边缘：出现翻页箭头
        await page.mouse.move(size.width - 30, 420);
        await expect(page.getByRole('button', { name: '下一页' })).toHaveClass(/visible/);
        await shot(page, 'edge-arrow', size.tag, scheme);
        await showToolbar(page);

        // 书签：加一个，按钮变实心
        await page.keyboard.press('Control+d');
        await expect(page.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'true');
        await shot(page, 'reader-bookmarked', size.tag, scheme);
        await page.keyboard.press('Control+d');
        await expect(page.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'false');

        // 外观面板：主页、字体与版式页
        await page.getByTestId('appearance-button').click();
        await expect(page.getByTestId('appearance-panel')).toBeVisible();
        await shot(page, 'appearance-main', size.tag, scheme);
        await page.getByTestId('appearance-custom').click();
        await expect(page.getByTestId('appearance-custom-page')).toBeVisible();
        await shot(page, 'appearance-custom', size.tag, scheme);
        await page.getByTestId('appearance-reset').click();
        await page.getByRole('button', { name: '返回', exact: true }).click();

        // 6 个主题各一张（面板收起，工具栏隐藏，只看页面和页脚）
        for (const t of THEMES) {
          await page.getByTestId(`theme-${t}`).click();
          await expect(page.getByTestId(`theme-${t}`)).toHaveAttribute('aria-checked', 'true');
          if (t === 'quiet') await shot(page, 'appearance-quiet', size.tag, scheme);
          await page.keyboard.press('Escape');
          await expect(page.getByTestId('appearance-panel')).toHaveCount(0);
          await hideToolbar(page);
          await shot(page, `theme-${t}`, size.tag, scheme);
          await showToolbar(page);
          await page.getByTestId('appearance-button').click();
          await expect(page.getByTestId('appearance-panel')).toBeVisible();
        }
        await page.getByTestId('theme-original').click();
        await page.keyboard.press('Escape');

        // 目录
        await page.keyboard.press('Control+t');
        await expect(page.getByTestId('toc-panel')).toBeVisible();
        await shot(page, 'toc', size.tag, scheme);
        await page.keyboard.press('Escape');

        // 搜索结果（输入简体）
        await page.keyboard.press('Control+f');
        await page.getByTestId('search-input').fill('认真');
        await expect(page.getByTestId('search-hit').first()).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('正在搜索…')).toHaveCount(0, { timeout: 20_000 });
        await shot(page, 'search', size.tag, scheme);

        // 点一条结果：跳转 + 闪烁高亮；页脚出现“返回”按钮
        await page.getByTestId('search-hit').nth(3).click();
        await expect(page.getByTestId('back-button')).toBeVisible();
        await page.waitForTimeout(250); // 闪烁高亮最亮的时候
        await showToolbar(page);
        await shot(page, 'footer-back', size.tag, scheme);

        // 书签列表
        await page.keyboard.press('Control+d');
        await page.keyboard.press('Control+Shift+d');
        await expect(page.getByTestId('bookmark-panel')).toBeVisible();
        await shot(page, 'bookmarks', size.tag, scheme);
      });
    });
  }
}
