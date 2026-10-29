// M2c 验收截图：高亮（各颜色）、选区菜单、笔记弹窗、要点精选面板；浅色、深色各一套。
// 存到 screenshots/M2c/。书是现场合成的（reading-book.ts）。
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { drawnHighlights, highlightPoint, patchHighlights, selectText } from './annotations-helpers';
import { gotoSection, ROOT, waitReaderReady } from './helpers';
import { openReadingBook } from './reading';

const OUT = path.join(ROOT, 'screenshots', 'M2c');

const SIZES = [
  { tag: 'w1144', width: 1144, height: 860 },
  { tag: 'w800', width: 800, height: 860 },
] as const;

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

/** 选一段字、点颜色（或笔记）。note 给了就写笔记 */
async function addHl(page: Page, needle: string, style: string, note?: string): Promise<void> {
  await selectText(page, needle);
  if (note) {
    await page.getByTestId('hl-note').click();
    await page.getByTestId('note-input').fill(note);
    await expect(page.getByTestId('note-status')).toHaveText('已保存');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('note-editor')).toHaveCount(0);
    if (style !== 'yellow') {
      const p = await highlightPoint(page, (await drawnHighlights(page)).length - 1);
      await page.mouse.click(p.x, p.y);
      await page.getByTestId(`hl-${style}`).click();
    }
  } else {
    await page.getByTestId(`hl-${style}`).click();
  }
}

const firstPara = (page: Page, n: number): Promise<string> =>
  page.evaluate((n) => window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc.querySelector('p')!.firstChild!.nodeValue!.slice(0, n), n);

async function hideToolbar(page: Page): Promise<void> {
  await page.mouse.move(page.viewportSize()!.width / 2, 420);
  await expect(page.getByTestId('toolbar')).not.toHaveClass(/visible/, { timeout: 4000 });
}

for (const size of SIZES) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`验收截图·标注·${size.tag}·${scheme === 'light' ? '浅色' : '深色'}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme, deviceScaleFactor: 1 });

      test(`高亮、菜单、笔记、要点精选 (${size.tag} ${scheme})`, async ({ page }) => {
        fs.mkdirSync(OUT, { recursive: true });
        await openReadingBook(page);
        await page.waitForTimeout(500);

        // 第一章第一页：6 种样式，其中两条带笔记
        await addHl(page, '搭船来到江南', 'yellow');
        await addHl(page, '岸边的柳树', 'green');
        await addHl(page, '未曾捞起的墨迹', 'blue', '先生的青瓷笔洗，水面总浮着一点墨。');
        await addHl(page, '在潮湿的空气里', 'pink');
        await addHl(page, '传得很远很远', 'underline');
        await addHl(page, '肯下笨功夫的人', 'purple', '雨是这座城的脾气。');
        await hideToolbar(page);
        await page.mouse.move(size.width / 2, 700);
        await shot(page, 'highlights', size.tag, scheme);

        // 选区菜单（新选的一段）
        await selectText(page, '一盏青瓷笔洗');
        await expect(page.getByTestId('sel-menu')).toBeVisible();
        await shot(page, 'menu-selection', size.tag, scheme);
        await page.keyboard.press('Escape');

        // 点在已有高亮上：菜单多一个删除，当前颜色有圈
        const p = await highlightPoint(page, 1);
        await page.mouse.click(p.x, p.y);
        await expect(page.getByTestId('hl-delete')).toBeVisible();
        await shot(page, 'menu-existing', size.tag, scheme);
        await page.keyboard.press('Escape');

        // 笔记弹窗（点便签图标）
        const icon = await page.evaluate(() => {
          const el = (window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.overlayer as unknown as { element: SVGElement }).element.querySelector('[data-note-icon] rect')!;
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        await page.mouse.click(icon.x, icon.y);
        await expect(page.getByTestId('note-editor')).toBeVisible();
        await shot(page, 'note-editor', size.tag, scheme);
        await page.keyboard.press('Escape');

        // 别的章节再加几条，让要点精选有分组
        await gotoSection(page, 2);
        await addHl(page, await firstPara(page, 10), 'yellow', '老茶馆里先生说的那句话，要记下来。');
        await gotoSection(page, 5);
        await addHl(page, await firstPara(page, 12), 'green');
        await gotoSection(page, 0);
        await page.waitForTimeout(400);

        // 要点精选
        await page.keyboard.press('Control+Shift+n');
        await expect(page.getByTestId('highlights-panel')).toBeVisible();
        await expect(page.getByTestId('hl-item')).toHaveCount(8);
        await shot(page, 'panel', size.tag, scheme);

        // 悬停一条：出现 … 菜单
        const item = page.getByTestId('hl-item').filter({ hasText: '肯下笨功夫的人' });
        await item.hover();
        await item.getByTestId('hl-more').click();
        await expect(page.getByRole('menuitem', { name: '编辑笔记' })).toBeVisible();
        await shot(page, 'panel-menu', size.tag, scheme);
        await page.getByRole('menuitem', { name: '编辑笔记' }).click();
        await expect(page.getByTestId('note-editor')).toBeVisible();
        await shot(page, 'panel-note', size.tag, scheme);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');

        // 无法定位分组：把两条改成找不到，刷新
        await patchHighlights(page, (hs) =>
          hs.map((h, i) => (i >= hs.length - 2 ? { ...h, text: '这段话后来被出版社改掉了，书里已经找不到', prefix: '改前的上文改前的上文', suffix: '改前的下文改前的下文', cfi: 'epubcfi(/6/2!/4/2/2/99)' } : h)),
        );
        await page.reload();
        await waitReaderReady(page);
        await page.keyboard.press('Control+Shift+n');
        await expect(page.getByTestId('hl-lost')).toBeVisible();
        await page.getByTestId('hl-lost').scrollIntoViewIfNeeded();
        await shot(page, 'panel-lost', size.tag, scheme);
      });
    });
  }
}

test.describe('验收截图·标注·深色页面与空面板', () => {
  test.use({ viewport: { width: 1144, height: 860 }, colorScheme: 'light', deviceScaleFactor: 1 });

  test('安静主题（深灰页面）里的高亮；空的要点精选', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await openReadingBook(page);
    await page.keyboard.press('Control+Shift+n');
    await expect(page.getByTestId('highlights-panel')).toBeVisible();
    await shot(page, 'panel-empty', 'w1144', 'light');
    await page.keyboard.press('Escape');

    await addHl(page, '搭船来到江南', 'yellow');
    await addHl(page, '岸边的柳树', 'green');
    await addHl(page, '未曾捞起的墨迹', 'blue', '先生的青瓷笔洗。');
    await addHl(page, '在潮湿的空气里', 'pink');
    await addHl(page, '传得很远很远', 'underline');
    await addHl(page, '肯下笨功夫的人', 'purple');
    await page.mouse.move(600, 30);
    await page.getByTestId('appearance-button').click();
    await page.getByTestId('theme-quiet').click();
    await page.keyboard.press('Escape');
    await hideToolbar(page);
    await shot(page, 'highlights-quiet', 'w1144', 'light');
    await page.mouse.move(600, 30);
    await page.getByTestId('appearance-button').click();
    await page.getByTestId('theme-calm').click();
    await page.keyboard.press('Escape');
    await hideToolbar(page);
    await shot(page, 'highlights-calm', 'w1144', 'light');
  });
});
