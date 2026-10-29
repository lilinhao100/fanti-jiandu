// M2d 验收截图：字体页（浅色、深色）、搜索“楷”、导入后的列表、自定义页（字号滑块）、字体不可用提示。
// 浏览器授权了本机字体（queryLocalFonts），列表是这台电脑的真实字体。输出到 screenshots/M2d/。
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ROOT } from './helpers';
import { openReadingBook } from './reading';

const OUT = path.join(ROOT, 'screenshots', 'M2d');
const FIXTURE_FONT = path.join(ROOT, 'fixtures', 'fonts', 'NotoSerifSC-subset.ttf');

async function shot(page: Page, name: string, scheme: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}-${scheme}.png`) });
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`验收截图·字体·${scheme === 'light' ? '浅色' : '深色'}`, () => {
    test.use({ viewport: { width: 1144, height: 860 }, colorScheme: scheme, deviceScaleFactor: 1 });

    test(`字体页、搜索、导入、自定义页 (${scheme})`, async ({ page, context }) => {
      fs.mkdirSync(OUT, { recursive: true });
      await context.grantPermissions(['local-fonts']);
      await openReadingBook(page);
      await page.mouse.move(572, 30);
      await page.getByTestId('appearance-button').click();
      await page.getByTestId('appearance-custom').click();
      await shot(page, 'custom-page', scheme);

      await page.getByTestId('font-row').click();
      await expect(page.getByText('系统字体', { exact: true })).toBeVisible({ timeout: 30_000 });
      await shot(page, 'font-page', scheme);

      await page.getByTestId('font-search').fill('楷');
      await expect(page.getByTestId('font-item').first()).toBeVisible();
      await shot(page, 'search-kai', scheme);
      await page.getByTestId('font-search').fill('');

      const chooser = page.waitForEvent('filechooser');
      await page.getByTestId('font-import').click();
      await (await chooser).setFiles(FIXTURE_FONT);
      await expect(page.getByText('我导入的', { exact: true })).toBeVisible();
      await page.locator('[data-font-id="imp:Noto Serif SC"]').click();
      await page.mouse.move(300, 500);
      await shot(page, 'imported', scheme);

      // 删掉被选中的导入字体：退回宋体并提示
      await page.locator('[data-font-id="imp:Noto Serif SC"]').hover();
      await page.getByTestId('font-delete').click();
      await expect(page.getByTestId('font-notice')).toBeVisible();
      await page.mouse.move(300, 500);
      await shot(page, 'removed-notice', scheme);

      // 西文字体页
      await page.getByTestId('font-back').click();
      await page.getByTestId('west-row').click();
      await expect(page.getByTestId('font-item').first()).toContainText('跟随中文字体');
      await shot(page, 'west-page', scheme);
    });
  });
}
