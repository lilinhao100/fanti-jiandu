import { expect, test, type Page } from '@playwright/test';
import {
  bookPath,
  currentLocation,
  currentSectionText,
  expectLocationChange,
  gotoSection,
  importBooks,
  openCard,
  searchableTexts,
  squash,
  waitForCards,
  waitReaderReady,
} from './helpers';

// fixtures/books/build.mjs 生成的小书：繁体、台湾词汇（軟體、網路）、直角引号。
// 每种格式各开一次，断言显示的是简体；再按 Ctrl+J 看到原文。
const FORMATS = [
  { name: 'epub 由 txt 拼成（Big5 编码）', file: 'tw-big5.txt', format: 'txt' },
  { name: 'fb2', file: 'tw-sample.fb2', format: 'fb2' },
  { name: 'mobi（MOBI6）', file: 'tw-sample.mobi', format: 'mobi' },
  { name: 'azw3（KF8）', file: 'tw-sample.azw3', format: 'azw3' },
] as const;

const SIMPLIFIED = ['“你好，世界”', '软件', '网络', '‘这不是梦’'];
const TRADITIONAL = ['「', '」', '『', '』', '軟體', '網路', '緣起'];

async function findSectionWith(page: Page, needle: string): Promise<number> {
  const texts = (await searchableTexts(page)).map(squash);
  return texts.findIndex((t) => t.includes(needle));
}

for (const f of FORMATS) {
  test(`${f.name}：导入、打开显示简体、目录是简体、Ctrl+J 看到原文`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await importBooks(page, [bookPath(f.file)]);
    await waitForCards(page, 1);

    // 书库：书名转成简体
    const cover = page.getByTestId('book-card').locator('.cover');
    await expect(cover).toContainText(/软件与网络的故事|tw-big5/);
    if (f.format !== 'txt') await expect(cover).not.toContainText('軟體');

    await openCard(page, /打开《/);
    if (f.format !== 'txt') await expect(page.getByTestId('book-title')).toHaveText('软件与网络的故事');
    await expect(page.getByTestId('script-toggle')).toHaveText('简');
    await expect(page.getByTestId('script-toggle')).toBeEnabled();

    // 渲染出来的正文（iframe 里的文档）
    const idx = await findSectionWith(page, '“你好，世界”');
    expect(idx, '搜索文本里应该有转换后的引号').toBeGreaterThanOrEqual(0);
    await gotoSection(page, idx);
    const shown = squash(await currentSectionText(page));
    for (const s of SIMPLIFIED) expect(shown, `应该显示：${s}`).toContain(s);
    for (const s of TRADITIONAL) expect(shown, `不该显示：${s}`).not.toContain(s);

    // 书内搜索读的也是简体
    const hits = await page.evaluate(() => window.__fjd!.controller.search('软件'));
    expect(hits.length).toBeGreaterThan(0);

    // 目录：简体
    await page.mouse.move(640, 20);
    await page.getByRole('button', { name: '目录' }).click();
    const panel = page.getByTestId('toc-panel');
    await expect(panel).toBeVisible();
    const labels = (await panel.locator('.toc-item').allTextContents()).join('|');
    expect(labels, '目录应包含简体章节名').toContain('第一章 缘起');
    expect(labels).not.toContain('緣');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // 翻页（这些书都很短，只验证不报错、位置合法）
    const loc = await currentLocation(page);
    expect(loc!.fraction).toBeGreaterThanOrEqual(0);

    // Ctrl+J：原文
    await page.keyboard.press('Control+j');
    await expect(page.getByTestId('reader')).toHaveAttribute('data-display', 'original');
    await waitReaderReady(page);
    await expect(page.getByTestId('script-toggle')).toHaveText('繁');
    const origIdx = await findSectionWith(page, '「你好，世界」');
    expect(origIdx).toBeGreaterThanOrEqual(0);
    await gotoSection(page, origIdx);
    const orig = squash(await currentSectionText(page));
    expect(orig).toContain('「你好，世界」');
    expect(orig).toContain('軟體');
    expect(orig).toContain('網路');
    expect(orig).not.toContain('软件');

    expect(errors, `页面错误：${errors.join('; ')}`).toEqual([]);
  });
}

test('进度按格式保存并恢复（mobi：关闭再打开回到原位）', async ({ page }) => {
  await page.goto('/');
  await importBooks(page, [bookPath('tw-sample.mobi')]);
  await waitForCards(page, 1);
  await openCard(page, /打开《/);
  const idx = await findSectionWith(page, '这是第一章的最后一段');
  await gotoSection(page, idx);
  const before = await currentLocation(page);
  await page.waitForTimeout(1500);
  await page.reload();
  await waitReaderReady(page);
  const after = await currentLocation(page);
  expect(after!.section).toBe(before!.section);
  expect(after!.cfi).toBe(before!.cfi);
});

test.describe('竖排书默认改成横排', () => {
  const VERTICAL = bookPath('tw-vertical.epub');

  const writingMode = (page: Page): Promise<{ mode: string; dir: string; bookDir: string | undefined }> =>
    page.evaluate(() => {
      const v = window.__fjd!.controller.debug.view as unknown as {
        book: { dir?: string };
        renderer: { getContents(): { doc: Document }[] };
      };
      const doc = v.renderer.getContents()[0]!.doc;
      return {
        mode: doc.defaultView!.getComputedStyle(doc.body).writingMode,
        dir: doc.defaultView!.getComputedStyle(doc.body).direction,
        bookDir: v.book.dir,
      };
    });

  test('默认：横排、从左往右翻页，竖排标点变普通标点', async ({ page }) => {
    await page.goto('/');
    await importBooks(page, [VERTICAL]);
    await waitForCards(page, 1);
    await openCard(page, /打开《/);

    const wm = await writingMode(page);
    expect(wm).toMatchObject({ mode: 'horizontal-tb', dir: 'ltr', bookDir: 'ltr' });
    const text = await currentSectionText(page);
    expect(text).toContain('“软件”与“网络”');
    expect(text).not.toContain('﹁');

    // 内联 style 也被改成横排
    const inlineMode = await page.evaluate(() => {
      const v = window.__fjd!.controller.debug.view!;
      const doc = v.renderer.getContents()[0]!.doc;
      const el = doc.querySelector('.inline')!;
      return doc.defaultView!.getComputedStyle(el).writingMode;
    });
    expect(inlineMode).toBe('horizontal-tb');

    // 翻页方向：→ 与点击右侧都是往后（进度增加），← 往前
    const start = await currentLocation(page);
    await expectLocationChange(page, () => page.keyboard.press('ArrowRight'));
    const next = await currentLocation(page);
    expect(next!.fraction).toBeGreaterThan(start!.fraction);
    await expectLocationChange(page, () => page.mouse.click(1100, 450));
    const next2 = await currentLocation(page);
    expect(next2!.fraction).toBeGreaterThan(next!.fraction);
    await expectLocationChange(page, () => page.keyboard.press('ArrowLeft'));
    expect((await currentLocation(page))!.fraction).toBeLessThan(next2!.fraction);
  });

  test('对照：把“竖排书改为横排”关掉，同一本书确实是竖排（证明夹具和转换都有效）', async ({ page }) => {
    await page.goto('/');
    await importBooks(page, [VERTICAL]);
    await waitForCards(page, 1);
    // 设置面板是 M2 的事，这里直接写 IndexedDB 里的设置
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('fjd');
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const tx = req.result.transaction('kv', 'readwrite');
            tx.objectStore('kv').put({ conversion: { horizontal: false } }, 'settings');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    await page.reload();
    await waitForCards(page, 1);
    await openCard(page, /打开《/);
    const wm = await writingMode(page);
    expect(wm.mode).toBe('vertical-rl');
    expect(wm.bookDir).toBe('rtl');
  });
});

test('本身就是简体的书：繁/简按钮置灰，文字原样显示，书库里书名不变', async ({ page }) => {
  await page.goto('/');
  await importBooks(page, [bookPath('sc-utf8.txt')]);
  await waitForCards(page, 1);
  await expect(page.getByTestId('book-card').locator('.cover')).toContainText('sc-utf8');
  await openCard(page, /打开《/);
  const toggle = page.getByTestId('script-toggle');
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute('title', '这本书本身就是简体');
  const idx = await findSectionWith(page, '“你好，世界”');
  expect(idx).toBeGreaterThanOrEqual(0);
  await gotoSection(page, idx);
  expect(squash(await currentSectionText(page))).toContain('第一套软件，使用网络连线把数据传到远端');
  // Ctrl+J 也不会切换
  await page.keyboard.press('Control+j');
  await expect(page.getByTestId('reader')).toHaveAttribute('data-display', 'converted');
  const opts = await page.evaluate(() => window.__fjd!.controller.debug.options);
  expect(opts).toMatchObject({ convert: false });
});
