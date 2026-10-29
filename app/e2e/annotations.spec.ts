// M2c：高亮、笔记、要点精选、标注重新定位
import { expect, test, type Page } from '@playwright/test';
import { currentLocation, gotoSection, waitReaderReady } from './helpers';
import { dragSelect, drawnHighlights, expectHighlights, highlightDebug, highlightPoint, patchHighlights, readAnnotations, selectText } from './annotations-helpers';
import { openReadingBook } from './reading';

// 第一章第一段里的句子（简体显示；原文是繁体）
const S1 = '搭船来到江南';
const S1_TW = '搭船來到江南';
const S2 = '岸边的柳树被洗得翠绿';

async function menuVisible(page: Page): Promise<void> {
  await expect(page.getByTestId('sel-menu')).toBeVisible();
}

async function saved(page: Page): Promise<void> {
  // 标注写盘是串行的 promise；轮询 IndexedDB，直到里面有预期的内容
  await expect.poll(async () => (await readAnnotations(page)).length).toBeGreaterThan(0);
}

test.describe('高亮与笔记', () => {
  test.use({ viewport: { width: 1144, height: 860 } });

  test('选中文字：弹出菜单（5 色、下划线、笔记、拷贝，没有删除）；加黄色高亮；刷新后仍在同一位置', async ({ page }) => {
    await openReadingBook(page);
    await selectText(page, S1);
    await menuVisible(page);
    const menu = page.getByTestId('sel-menu');
    for (const c of ['yellow', 'green', 'blue', 'pink', 'purple']) await expect(menu.getByTestId(`hl-${c}`)).toBeVisible();
    await expect(menu.getByTestId('hl-underline')).toBeVisible();
    await expect(menu.getByTestId('hl-note')).toBeVisible();
    await expect(menu.getByTestId('hl-copy')).toBeVisible();
    await expect(menu.getByTestId('hl-delete')).toHaveCount(0);

    await menu.getByTestId('hl-yellow').click();
    await expect(menu).toHaveCount(0);
    const before = await expectHighlights(page, [S1]);
    const drawn = await drawnHighlights(page);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.style).toBe('yellow');
    expect(drawn[0]!.rects).toBeGreaterThan(0);

    // 存盘内容：text、prefix、suffix、anchor
    await saved(page);
    const [rec] = await readAnnotations(page);
    const h = rec!.data.highlights[0]!;
    expect(h.text).toBe(S1);
    expect(String(h.prefix).length).toBeGreaterThan(5);
    expect(String(h.suffix).length).toBeGreaterThan(5);
    expect(h.style).toBe('yellow');
    expect(h.anchor).toMatchObject({ mode: 'converted', engine: 1 });
    expect(typeof (h.anchor as { optsKey: string }).optsKey).toBe('string');
    expect(String(h.cfi)).toMatch(/^epubcfi\(/);

    await page.reload();
    await waitReaderReady(page);
    const after = await expectHighlights(page, [S1]);
    expect(after[0]!.start).toBe(before[0]!.start);
    expect((await drawnHighlights(page)).map((d) => d.style)).toEqual(['yellow']);
  });

  test('真实鼠标拖选也能弹出菜单；点页面别处关闭菜单且不翻页；Esc 关闭并取消选区', async ({ page }) => {
    await openReadingBook(page);
    await dragSelect(page, S2);
    await menuVisible(page);
    // 选区菜单在选区上方 8px 左右
    const mb = (await page.getByTestId('sel-menu').boundingBox())!;
    expect(mb.height).toBeGreaterThan(30);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sel-menu')).toHaveCount(0);
    expect(await page.evaluate(() => window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc.getSelection()!.toString())).toBe('');

    // 再选一次，点页面空白处（右三分之一，本来会翻页）：只关菜单，不翻页
    await dragSelect(page, S2);
    await menuVisible(page);
    const loc = await currentLocation(page);
    await page.mouse.click(1000, 600);
    await expect(page.getByTestId('sel-menu')).toHaveCount(0);
    await page.waitForTimeout(600);
    expect((await currentLocation(page))!.cfi).toBe(loc!.cfi);
  });

  test('6 种样式都能画：5 种颜色和下划线', async ({ page }) => {
    await openReadingBook(page);
    const picks: [string, string][] = [
      ['yellow', '搭船来到江南'],
      ['green', '岸边的柳树'],
      ['blue', '手里握着一把'],
      ['pink', '被雨水磨得发亮'],
      ['purple', '都能听见鞋底'],
      ['underline', '轻轻摩擦的声音'],
    ];
    for (const [style, needle] of picks) {
      await selectText(page, needle);
      await page.getByTestId(`hl-${style}`).click();
    }
    await expectHighlights(page, picks.map((p) => p[1]));
    expect((await drawnHighlights(page)).map((d) => d.style).sort()).toEqual(picks.map((p) => p[0]).sort());
  });

  test('点在已有高亮上：菜单多一个删除；换颜色；删除后刷新确实不在了', async ({ page }) => {
    await openReadingBook(page);
    await selectText(page, S1);
    await page.getByTestId('hl-yellow').click();
    await expectHighlights(page, [S1]);

    // 点高亮（点击落在页面左三分之一内不会翻页）
    const p = await highlightPoint(page);
    const loc = await currentLocation(page);
    await page.mouse.click(p.x, p.y);
    await menuVisible(page);
    await expect(page.getByTestId('hl-delete')).toBeVisible();
    await expect(page.getByTestId('hl-yellow')).toHaveAttribute('aria-pressed', 'true');
    expect((await currentLocation(page))!.cfi).toBe(loc!.cfi);

    // 换成蓝色：还是一条高亮
    await page.getByTestId('hl-blue').click();
    await expect.poll(async () => (await drawnHighlights(page)).map((d) => d.style)).toEqual(['blue']);
    expect(await highlightDebug(page)).toHaveLength(1);

    // 删除
    await page.mouse.click(p.x, p.y);
    await page.getByTestId('hl-delete').click();
    await expect.poll(async () => (await drawnHighlights(page)).length).toBe(0);
    expect(await highlightDebug(page)).toHaveLength(0);
    await expect.poll(async () => (await readAnnotations(page))[0]?.data.highlights.length).toBe(0);

    await page.reload();
    await waitReaderReady(page);
    expect(await highlightDebug(page)).toHaveLength(0);
    expect(await drawnHighlights(page)).toHaveLength(0);
  });

  test('拷贝：复制的是当前显示的文字（简体），在显示原文时复制的是繁体', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openReadingBook(page);
    await selectText(page, S1);
    await page.getByTestId('hl-copy').click();
    await expect(page.getByTestId('sel-menu')).toHaveCount(0);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(S1);

    // 切到原文再选、再拷贝
    await page.keyboard.press('Control+j');
    await expect(page.getByTestId('reader')).toHaveAttribute('data-display', 'original');
    await waitReaderReady(page);
    await selectText(page, S1_TW);
    await page.getByTestId('hl-copy').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(S1_TW);
  });

  test('笔记：弹窗自动保存，Esc 关闭；页边出现便签图标；点图标重新打开；清空笔记后图标消失', async ({ page }) => {
    await openReadingBook(page);
    await selectText(page, S1);
    await page.getByTestId('hl-note').click();
    const ed = page.getByTestId('note-editor');
    await expect(ed).toBeVisible();
    await expect(page.getByTestId('note-input')).toBeFocused();
    await page.getByTestId('note-input').fill('这一句写得真好\n第二行');
    await expect(page.getByTestId('note-status')).toHaveText('已保存');
    await page.keyboard.press('Escape');
    await expect(ed).toHaveCount(0);

    const [rec] = await readAnnotations(page);
    expect(rec!.data.highlights[0]!.note).toBe('这一句写得真好\n第二行');
    expect(rec!.data.highlights[0]!.style).toBe('yellow'); // 从“笔记”进来默认黄色
    // 便签图标
    const icons = (): Promise<number> =>
      page.evaluate(() => (window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.overlayer as unknown as { element: SVGElement }).element.querySelectorAll('[data-note-icon]').length);
    await expect.poll(icons).toBe(1);

    // 点图标重新打开笔记弹窗（不翻页）
    const pos = await page.evaluate(() => {
      const el = (window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.overlayer as unknown as { element: SVGElement }).element.querySelector('[data-note-icon] rect')!;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const loc = await currentLocation(page);
    await page.mouse.click(pos.x, pos.y);
    await expect(ed).toBeVisible();
    await expect(page.getByTestId('note-input')).toHaveValue('这一句写得真好\n第二行');
    expect((await currentLocation(page))!.cfi).toBe(loc!.cfi);

    // 关闭时也会保存：清空后图标消失，高亮保留
    await page.getByTestId('note-input').fill('');
    await page.keyboard.press('Escape');
    await expect(ed).toHaveCount(0);
    await expect.poll(icons).toBe(0);
    expect(await drawnHighlights(page)).toHaveLength(1);
    await expect.poll(async () => (await readAnnotations(page))[0]?.data.highlights[0]?.note).toBeUndefined();
  });

  test('要点精选：Ctrl+Shift+N 开关；按章节分组；点击跳转；编辑笔记；删除', async ({ page }) => {
    await openReadingBook(page);
    // 第一章加一条带笔记的，第四章加一条
    await selectText(page, S1);
    await page.getByTestId('hl-note').click();
    await page.getByTestId('note-input').fill('第一章的笔记');
    await expect(page.getByTestId('note-status')).toHaveText('已保存');
    await page.keyboard.press('Escape');

    await gotoSection(page, 3);
    const first = await page.evaluate(() => window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc.querySelector('p')!.firstChild!.nodeValue!.slice(0, 8));
    await selectText(page, first);
    await page.getByTestId('hl-green').click();

    await page.keyboard.press('Control+Shift+n');
    const panel = page.getByTestId('highlights-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('hl-group')).toHaveCount(2);
    await expect(page.getByTestId('hl-item')).toHaveCount(2);
    await expect(page.getByTestId('hl-group').first()).toContainText('第一章');
    await expect(page.getByTestId('hl-item').first()).toContainText(S1);
    await expect(page.getByTestId('hl-item').first()).toContainText('第一章的笔记');
    await expect(page.getByTestId('hl-lost')).toHaveCount(0);
    await expect(page.getByTestId('highlights-button')).toHaveAttribute('aria-pressed', 'true');

    // 点第一条跳转（现在在第四章）
    expect((await currentLocation(page))!.section).toBe(3);
    await page.getByTestId('hl-item').first().getByTestId('hl-jump').click();
    await expect(panel).toHaveCount(0);
    await expect.poll(async () => (await currentLocation(page))?.section).toBe(0);
    await expectHighlights(page, [S1]); // 回到第一章，高亮在画面上
    // 高亮的色块在可见区域里
    const pt = await highlightPoint(page);
    expect(pt.x).toBeGreaterThan(0);
    expect(pt.x).toBeLessThan(1144);

    // 编辑笔记：悬停出现 …，菜单里选“编辑笔记”，改完自动保存
    await page.keyboard.press('Control+Shift+n');
    const item = page.getByTestId('hl-item').first();
    await item.hover();
    await item.getByTestId('hl-more').click();
    await page.getByRole('menuitem', { name: '编辑笔记' }).click();
    await expect(page.getByTestId('note-editor')).toBeVisible();
    await expect(panel).toBeVisible(); // 面板还开着
    await page.getByTestId('note-input').fill('改过的笔记');
    await expect(page.getByTestId('note-status')).toHaveText('已保存');
    await expect(item).toContainText('改过的笔记');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('note-editor')).toHaveCount(0);
    await expect(panel).toBeVisible();

    // 删除第二条
    const second = page.getByTestId('hl-item').nth(1);
    await second.hover();
    await second.getByTestId('hl-more').click();
    await page.getByRole('menuitem', { name: '删除' }).click();
    await expect(page.getByTestId('hl-item')).toHaveCount(1);
    await expect.poll(async () => (await readAnnotations(page))[0]?.data.highlights.length).toBe(1);

    // Esc 关闭面板
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
  });

  test('Ctrl+J 切到繁体：高亮仍在对应的文字上（重新定位）；再切回简体也在', async ({ page }) => {
    await openReadingBook(page);
    await selectText(page, S1);
    await page.getByTestId('hl-yellow').click();
    await selectText(page, '被雨水磨得发亮');
    await page.getByTestId('hl-underline').click();
    const before = await expectHighlights(page, [S1, '被雨水磨得发亮']);

    await page.keyboard.press('Control+j');
    await expect(page.getByTestId('reader')).toHaveAttribute('data-display', 'original');
    await waitReaderReady(page);
    const tw = await expectHighlights(page, [S1_TW, '被雨水磨得發亮']);
    // 同一个位置：章内偏移不同（词汇转换会改字数），但先后顺序一样，而且都在第一章
    const order = (hs: typeof tw): string[] => [...hs].sort((a, b) => a.start - b.start).map((h) => h.id);
    expect(order(tw)).toEqual(order(before));
    expect((await drawnHighlights(page)).map((d) => d.style).sort()).toEqual(['underline', 'yellow']);
    // 面板里的文字也跟着显示模式走
    await page.keyboard.press('Control+Shift+n');
    await expect(page.getByTestId('hl-item').first()).toContainText(S1_TW);
    await page.keyboard.press('Escape');

    // 在原文模式里再加一条，切回简体：也能定位，面板里是简体
    await selectText(page, '那年春天');
    await page.getByTestId('hl-pink').click();
    await page.keyboard.press('Control+j');
    await expect(page.getByTestId('reader')).toHaveAttribute('data-display', 'converted');
    await waitReaderReady(page);
    await expectHighlights(page, [S1, '被雨水磨得发亮', '那年春天']);
    await page.keyboard.press('Control+Shift+n');
    await expect(page.getByTestId('hl-lost')).toHaveCount(0);
    await expect(page.getByTestId('hl-item')).toHaveCount(3);
    await expect(page.getByTestId('hl-item').filter({ hasText: S1_TW })).toHaveCount(0);
  });

  test('改了排版设置后高亮仍盖在原来的文字上；刷新后也是', async ({ page }) => {
    await openReadingBook(page);
    await selectText(page, S1);
    await page.getByTestId('hl-yellow').click();
    await expectHighlights(page, [S1]);
    const covers = (): Promise<boolean> =>
      page.evaluate(() => {
        const c = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!;
        const doc = c.doc;
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = (n.nodeValue ?? '').indexOf('搭船来到江南');
          if (i < 0) continue;
          const r = doc.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 6);
          const tr = r.getBoundingClientRect();
          const fr = (doc.defaultView!.frameElement as HTMLElement).getBoundingClientRect();
          const g = (c.overlayer as unknown as { element: SVGElement }).element.querySelector('g[data-hl] rect')!.getBoundingClientRect();
          const cx = fr.left + tr.left + tr.width / 2;
          const cy = fr.top + tr.top + tr.height / 2;
          // 文字所在页和高亮色块必须叠在一起（允许 3px 误差）
          return cx >= g.left - 3 && cx <= g.right + 3 && cy >= g.top - 3 && cy <= g.bottom + 3 && (g.width > 0);
        }
        return false;
      });
    expect(await covers()).toBe(true);
    for (const key of ['Control+=', 'Control+=', 'Control+-', 'Control+0']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(900);
      expect(await covers(), key).toBe(true);
    }
    // 切主题（深色页面：叠加方式变了）
    await page.mouse.move(600, 30);
    await page.getByTestId('appearance-button').click();
    await page.getByTestId('theme-quiet').click();
    await page.waitForTimeout(600);
    expect(await covers()).toBe(true);
    const mode = await page.evaluate(() => {
      const g = (window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.overlayer as unknown as { element: SVGElement }).element.querySelector('g[data-hl] > g') as SVGGElement;
      return g.style.mixBlendMode;
    });
    expect(mode).toBe('normal');
    await page.getByTestId('theme-original').click();
    await page.waitForTimeout(600);
    const mode2 = await page.evaluate(() => {
      const g = (window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.overlayer as unknown as { element: SVGElement }).element.querySelector('g[data-hl] > g') as SVGGElement;
      return g.style.mixBlendMode;
    });
    expect(mode2).toBe('multiply');
  });

  test('重新定位：CFI 失效、引擎版本变了，靠 prefix/text/suffix 找回；彻底找不到的进“无法定位”，数据不丢', async ({ page }) => {
    await openReadingBook(page);
    await selectText(page, S1);
    await page.getByTestId('hl-yellow').click();
    await selectText(page, S2);
    await page.getByTestId('hl-green').click();
    await expectHighlights(page, [S1, S2]);
    await expect.poll(async () => (await readAnnotations(page))[0]?.data.highlights.length).toBe(2);

    await patchHighlights(page, (hs) =>
      hs.map((h, i) =>
        i === 0
          ? { ...h, cfi: 'epubcfi(/6/2!/4/2/2/99)', anchor: { mode: 'converted', engine: 0, optsKey: 'old' } } // CFI 指向不存在的位置
          : { ...h, text: '这句话书里根本没有', prefix: '没有的前文没有的前文', suffix: '没有的后文没有的后文', cfi: 'epubcfi(/6/2!/4/2/2/99)' },
      ),
    );
    await page.reload();
    await waitReaderReady(page);
    await expect.poll(async () => (await highlightDebug(page)).filter((h) => h.located).length).toBe(1);
    expect((await highlightDebug(page)).find((h) => h.located)!.text).toBe(S1);

    await page.keyboard.press('Control+Shift+n');
    await expect(page.getByTestId('hl-lost')).toBeVisible();
    await expect(page.getByTestId('hl-lost').getByTestId('hl-item')).toHaveCount(1);
    await expect(page.getByTestId('hl-lost')).toContainText('这句话书里根本没有');
    // 数据没丢：存档里仍是两条
    expect((await readAnnotations(page))[0]!.data.highlights).toHaveLength(2);
    // “无法定位”里的可以删除
    const lost = page.getByTestId('hl-lost').getByTestId('hl-item');
    await lost.hover();
    await lost.getByTestId('hl-more').click();
    await page.getByRole('menuitem', { name: '删除' }).click();
    await expect(page.getByTestId('hl-lost')).toHaveCount(0);
  });

  test('从书库移除书：标注一起删', async ({ page }) => {
    await openReadingBook(page);
    await selectText(page, S1);
    await page.getByTestId('hl-yellow').click();
    await saved(page);
    expect(await readAnnotations(page)).toHaveLength(1);
    await page.mouse.move(600, 30);
    await page.getByRole('button', { name: '返回书库' }).click();
    await expect(page.getByTestId('book-card')).toHaveCount(1);
    await page.getByTestId('book-card').getByRole('button', { name: '更多' }).click();
    await page.getByRole('menuitem', { name: /从书库移除/ }).click();
    await page.getByRole('button', { name: '移除' }).click();
    await expect(page.getByTestId('book-card')).toHaveCount(0);
    expect(await readAnnotations(page)).toHaveLength(0);
  });
});
