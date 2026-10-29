// M2a：书库窗口与设置的行为、布局数值（DESIGN 第 1、4 节）。截图验收在 screens.spec.ts。
import { expect, test, type Page } from '@playwright/test';
import { buildEpub, drawCover } from './epubs';
import { bookPath, importBooks, openCard, patchBook, waitForCards, waitReaderReady } from './helpers';
import { seedLibrary } from './seed';

test.use({ viewport: { width: 1144, height: 860 }, colorScheme: 'light', deviceScaleFactor: 1 });

type Rect = { x: number; y: number; w: number; h: number };
const rectOf = (page: Page, selector: string): Promise<Rect[]> =>
  page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel)).map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
  }, selector);

async function seeded(page: Page): Promise<void> {
  await page.goto('/');
  await seedLibrary(page);
  const t = Date.now() + 60_000;
  await patchBook(page, '星圖', { lastOpenedAt: t + 3, progress: { cfi: 'x', fraction: 0.18, updatedAt: 1 } });
  await patchBook(page, '舊鐘樓', { lastOpenedAt: t + 2, progress: { cfi: 'x', fraction: 0.62, updatedAt: 1 } });
  await patchBook(page, '風信子', { lastOpenedAt: t + 1, progress: { cfi: 'x', fraction: 1, updatedAt: 1 } });
  await page.reload();
  await waitForCards(page, 9);
}

test.describe('书库·布局数值', () => {
  test('侧边栏、内容区、封面网格、标签行', async ({ page }) => {
    await seeded(page);
    const [sidebar] = await rectOf(page, '.sidebar');
    expect(sidebar).toMatchObject({ x: 10, y: 10, w: 240, h: 840 });
    const [item] = await rectOf(page, '.sidebar .item.selected');
    expect(item!.h).toBe(34);
    expect(item!.x - sidebar!.x).toBeCloseTo(11, 0); // 左右内边距 10 + 0.5px 边框

    const covers = await rectOf(page, '[data-testid="book-card"] .cover');
    // 内容区从侧边栏右边缘往右 45px：295
    expect(covers[0]!.x).toBe(295);
    // 一行 4 本，封面宽度在 150–200 之间，列间距 26
    const row1 = covers.filter((c) => Math.abs(c.y + c.h - (covers[0]!.y + covers[0]!.h)) < 1);
    expect(row1).toHaveLength(4);
    for (const c of row1) {
      expect(c.w).toBeGreaterThanOrEqual(150);
      expect(c.w).toBeLessThanOrEqual(200);
    }
    expect(row1[1]!.x - (row1[0]!.x + row1[0]!.w)).toBeCloseTo(26, 0);
    // 右边留 45px
    const last = row1[3]!;
    expect(1144 - (last.x + last.w)).toBeCloseTo(45, 0);
    // 第一行封面顶（最高的那本）距窗口顶 162
    const top = Math.min(...row1.map((c) => c.y));
    expect(top).toBe(162);
    // 底部对齐：同一行所有封面下沿相同，不同比例的封面上沿参差
    expect(new Set(row1.map((c) => Math.round(c.y + c.h))).size).toBe(1);
    expect(new Set(row1.map((c) => Math.round(c.h))).size).toBeGreaterThan(1);
    // 标签行：高 20，封面下方 10；封面底到下一行最高封面顶的距离 = 64
    const labels = await rectOf(page, '[data-testid="book-card"] .card-label');
    expect(labels[0]!.h).toBe(20);
    expect(labels[0]!.y - (covers[0]!.y + covers[0]!.h)).toBe(10);
    const row2Top = Math.min(...covers.filter((c) => c.y > covers[0]!.y + covers[0]!.h).slice(0, 4).map((c) => c.y));
    expect(row2Top - (row1[0]!.y + row1[0]!.h)).toBe(64);
    // 状态：新增胶囊、进度、已读完
    const card = page.getByTestId('book-card');
    await expect(card.getByText('新增').first()).toBeVisible();
    await expect(card.getByText('18%')).toBeVisible();
    await expect(card.getByText('已读完')).toBeVisible();
    await expect(card.getByText('62%')).toBeVisible();
  });

  test('窗口大小：最小 760×520 是 2 列、不出横向滚动；加宽后列数增加，封面宽度始终在 150–200', async ({ page }) => {
    await seeded(page);
    const cols = async (): Promise<{ n: number; w: number[]; overflow: boolean }> => {
      const covers = await rectOf(page, '[data-testid="book-card"] .cover');
      const xs = [...new Set(covers.map((c) => Math.round(c.x)))];
      const overflow = await page.evaluate(() => {
        const el = document.querySelector('.content')!;
        return el.scrollWidth > el.clientWidth;
      });
      return { n: xs.length, w: covers.map((c) => c.w), overflow };
    };
    await page.setViewportSize({ width: 760, height: 520 });
    await expect.poll(async () => (await cols()).n).toBe(2);
    expect((await cols()).overflow).toBe(false);
    for (const [width, n] of [[1144, 4], [1600, 6], [2000, 8]] as const) {
      await page.setViewportSize({ width, height: 860 });
      await expect.poll(async () => (await cols()).n, `${width}px`).toBe(n);
      const { w, overflow } = await cols();
      expect(overflow).toBe(false);
      for (const x of w) {
        expect(x).toBeGreaterThanOrEqual(150);
        expect(x).toBeLessThanOrEqual(200);
      }
    }
  });

  test('窗口按钮 46×32 贴右上角；标题 56px；更多按钮 36px；关闭按钮悬停变红', async ({ page }) => {
    await seeded(page);
    const btns = await rectOf(page, '.wc-btn');
    expect(btns).toHaveLength(3);
    for (const b of btns) expect([b.w, b.h]).toEqual([46, 32]);
    expect(btns[2]!.x + btns[2]!.w).toBe(1144);
    expect(btns[0]!.y).toBe(0);
    const [more] = await rectOf(page, '[data-testid="more-button"]');
    expect([more!.w, more!.h]).toEqual([36, 36]);
    const [h1] = await rectOf(page, '.content-header h1');
    expect(h1!.y).toBe(56);
    await page.getByRole('button', { name: '关闭', exact: true }).hover();
    await expect(page.getByRole('button', { name: '关闭', exact: true })).toHaveCSS('background-color', 'rgb(196, 43, 28)');
  });

  test('列表视图：行高 56，缩略图高 44；主页：继续阅读卡片 300×120，只收读过没读完的', async ({ page }) => {
    await seeded(page);
    await page.getByTestId('more-button').click();
    await page.getByRole('menuitemradio', { name: '列表' }).click();
    const rows = await rectOf(page, '[data-testid="book-row"]');
    expect(rows).toHaveLength(9);
    for (const r of rows) expect(r.h).toBe(56);
    const thumbs = await rectOf(page, '[data-testid="book-row"] .thumb .cover');
    for (const t of thumbs) expect(t.h).toBe(44);
    // 设置记住了：刷新后还是列表
    await page.reload();
    await expect(page.getByTestId('book-row')).toHaveCount(9);
    await page.getByTestId('more-button').click();
    await page.getByRole('menuitemradio', { name: '网格' }).click();
    await expect(page.getByTestId('book-card')).toHaveCount(9);

    await page.getByTestId('nav-home').click();
    const conts = page.getByTestId('continue-card');
    await expect(conts).toHaveCount(2); // 星圖 18%、舊鐘樓 62%；風信子已读完，不算
    const cr = await rectOf(page, '[data-testid="continue-card"]');
    for (const c of cr) expect([c.w, c.h]).toEqual([300, 120]);
    await expect(conts.first()).toContainText('图书 · 18%');
    // 卡片底色取自封面平均色
    await expect(conts.first()).toHaveAttribute('style', /--card-tint: rgb\(/);
    await expect(page.getByRole('heading', { name: '最近添加' })).toBeVisible();
    await expect(page.getByTestId('recent-grid').getByTestId('book-card')).toHaveCount(9);
    // 点卡片打开
    await conts.first().click();
    await waitReaderReady(page);
  });
});

test.describe('书库·侧边栏、设置、深色', () => {
  test('侧边栏没有“搜索”：只有主页和全部（不做联网书库）', async ({ page }) => {
    await seeded(page);
    await expect(page.getByTestId('nav-search')).toHaveCount(0);
    await expect(page.getByTestId('sidebar').getByText('搜索')).toHaveCount(0);
    await expect(page.getByTestId('nav-home')).toBeVisible();
    await expect(page.getByTestId('nav-all')).toBeVisible();
  });

  test('Ctrl+, 打开设置；转换开关写进存档；Esc 关闭；关于页显示版本', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('empty-library')).toBeVisible();
    await page.keyboard.press('Control+,');
    const dlg = page.getByTestId('settings');
    await expect(dlg).toBeVisible();
    // 用 offsetWidth：弹出动画有 scale(.96)，boundingBox 会带上它
    const size = await dlg.evaluate((el: HTMLElement) => [el.offsetWidth, el.offsetHeight]);
    expect(size).toEqual([600, 460]);
    await expect(dlg.getByRole('heading', { name: '繁简转换' })).toBeVisible();
    await expect(dlg).toContainText('所有转换都在本机完成，不联网；原文件不会被修改。');
    for (const name of ['词汇转换', '引号转换', '排版清理', '竖排书改为横排']) {
      await expect(dlg.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'true');
    }
    await dlg.getByRole('switch', { name: '词汇转换' }).click();
    await expect(dlg.getByRole('switch', { name: '词汇转换' })).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);

    // 存档里变了，刷新后还是关着
    await page.reload();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByRole('switch', { name: '词汇转换' })).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: '阅读' }).click();
    await expect(page.getByRole('radio', { name: /宋体/ })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: /楷体/ }).click();
    await expect(page.getByRole('radio', { name: /楷体/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('switch', { name: '翻页动画' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: '关于' }).click();
    await expect(page.getByTestId('about-version')).toHaveText('0.1.0');
    await expect(page.getByTestId('about-engine')).toHaveText(/^\d+$/);
    await expect(page.getByTestId('settings')).toContainText('OpenCC');
    await expect(page.getByTestId('settings')).toContainText('foliate-js');
    await expect(page.getByTestId('settings')).toContainText('Phosphor');
    await page.getByRole('button', { name: '关闭设置' }).click();
    await expect(page.getByTestId('settings')).toHaveCount(0);
    // 点遮罩也能关
    await page.keyboard.press('Control+,');
    await expect(page.getByTestId('settings')).toBeVisible();
    await page.mouse.click(20, 20);
    await expect(page.getByTestId('settings')).toHaveCount(0);
  });

  test('深色模式：默认跟随系统；设置里的页面模式可以覆盖，并且刷新后仍然生效', async ({ page }) => {
    const bg = (): Promise<string> => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await expect(page.getByTestId('empty-library')).toBeVisible();
    expect(await bg()).toBe('rgb(255, 255, 255)');
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await bg()).toBe('rgb(30, 30, 30)'); // #1E1E1E
    await page.emulateMedia({ colorScheme: 'light' });

    // 固定成深色：系统是浅色也深色
    await page.getByTestId('nav-settings').click();
    await page.getByRole('button', { name: '阅读' }).click();
    await page.getByRole('radio', { name: '深色' }).click();
    expect(await bg()).toBe('rgb(30, 30, 30)');
    await page.reload();
    // 先于渲染就是深色（index.html 里的小脚本），不会先白后黑
    expect(await bg()).toBe('rgb(30, 30, 30)');
    await expect(page.getByTestId('empty-library')).toBeVisible();
    expect(await bg()).toBe('rgb(30, 30, 30)');
    // 固定成浅色：系统是深色也浅色
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.getByTestId('nav-settings').click();
    await page.getByRole('button', { name: '阅读' }).click();
    await page.getByRole('radio', { name: '浅色' }).click();
    expect(await bg()).toBe('rgb(255, 255, 255)');
    // 自动：回到跟随系统
    await page.getByRole('radio', { name: '自动' }).click();
    expect(await bg()).toBe('rgb(30, 30, 30)');
  });

  test('阅读页里 Ctrl+, 也能打开设置', async ({ page }) => {
    await page.goto('/');
    await importBooks(page, [bookPath('tw-sample.fb2')]);
    await waitForCards(page, 1);
    await openCard(page, /打开《/);
    await page.keyboard.press('Control+,');
    await expect(page.getByTestId('settings')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings')).toHaveCount(0);
  });
});

test.describe('书名清理与封面兜底', () => {
  const cover = (page: Page, title: string): Promise<Buffer> =>
    drawCover(page, { w: 400, h: 600, title, author: 'x', bg: ['#223', '#446'], fg: '#fff', accent: '#c33', style: 'band' });

  test('书名后缀“(Traditional Chinese Edition)”之类：书库、阅读页都不显示，原始元数据不改', async ({ page }) => {
    await page.goto('/');
    const mk = (title: string): { name: string; mimeType: string; buffer: Buffer } => ({
      name: `${title.slice(0, 4)}.epub`,
      mimeType: 'application/epub+zip',
      buffer: Buffer.from(buildEpub({ title, author: 'A' })),
    });
    await importBooks(page, [
      mk('燈塔日記 (Traditional_chinese Edition)'),
      mk('日常練習（繁體中文版）'),
      mk('星圖(繁體版)'),
      mk('Plain Notes (TRADITIONAL CHINESE EDITION)'),
    ]);
    await waitForCards(page, 4);
    const text = await page.getByTestId('book-grid').innerText();
    expect(text).not.toMatch(/edition|繁體|繁体/i);
    for (const t of ['灯塔日记', '日常练习', '星图', 'Plain Notes']) {
      await expect(page.getByRole('button', { name: new RegExp(`打开《${t}》`) })).toHaveCount(1);
    }
    // 阅读页的标题也干净
    await openCard(page, /打开《灯塔日记》/);
    await expect(page.getByTestId('book-title')).toHaveText('灯塔日记');
    // 原始元数据没动
    const raw = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const req = indexedDB.open('fjd');
          req.onsuccess = () => {
            const r = req.result.transaction('books').objectStore('books').getAll();
            r.onsuccess = () => resolve((r.result as { title: string }[]).map((b) => b.title));
          };
        }),
    );
    expect(raw).toContain('燈塔日記 (Traditional_chinese Edition)');
  });

  test('OPF 没标记封面：第一页只有一张图 / 图在文字前面 / manifest 里有 cover 图片，都用上；都没有才用生成封面', async ({ page }) => {
    await page.goto('/');
    const mk = async (title: string, mode: 'marked' | 'image-page' | 'first-image' | 'manifest' | 'none') => ({
      name: `${title}.epub`,
      mimeType: 'application/epub+zip',
      buffer: Buffer.from(
        buildEpub({ title, author: 'A', cover: mode === 'none' ? undefined : await cover(page, title), coverMode: mode === 'none' ? undefined : mode }),
      ),
    });
    await importBooks(page, [await mk('甲', 'marked'), await mk('乙', 'image-page'), await mk('丙', 'first-image'), await mk('丁', 'manifest'), await mk('戊', 'none')]);
    await waitForCards(page, 5);
    for (const t of ['甲', '乙', '丙', '丁']) {
      await expect(page.getByTestId('book-card').filter({ hasText: '' }).filter({ has: page.getByRole('button', { name: `打开《${t}》` }) }).getByTestId('cover-image'), t).toHaveCount(1);
    }
    await expect(page.getByTestId('book-card').filter({ has: page.getByRole('button', { name: '打开《戊》' }) }).getByTestId('generated-cover')).toHaveCount(1);
    expect(await page.getByTestId('cover-image').count()).toBe(4);
  });

  test('第一页是小图标加正文（不是封面）：不会把它当封面', async ({ page }) => {
    await page.goto('/');
    const small = await drawCover(page, { w: 64, h: 64, title: 'L', author: '', bg: ['#fff', '#eee'], fg: '#000', accent: '#c33', style: 'circle' });
    await importBooks(page, [{ name: '己.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(buildEpub({ title: '己', author: 'A', cover: small, coverMode: 'first-image' })) }]);
    await waitForCards(page, 1);
    await expect(page.getByTestId('generated-cover')).toHaveCount(1);
  });
});
