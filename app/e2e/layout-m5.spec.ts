// M5：字体与版式页（行距、页边距、栏数）的 e2e。没有“自定义”开关，滑块一直可用；栏数 自动/单栏/双栏。
import { expect, test, type Page } from '@playwright/test';
import { bookPath, currentLocation, expectLocationChange, gotoSection, importBooks, openCard, waitForCards, waitReaderReady } from './helpers';
import { openReadingBook } from './reading';

async function showToolbar(page: Page): Promise<void> {
  await page.mouse.move(page.viewportSize()!.width / 2, 30);
  await expect(page.getByTestId('toolbar')).toHaveClass(/visible/);
}

/** 打开外观面板的“字体与版式”页 */
async function openLayoutPage(page: Page): Promise<void> {
  if (await page.getByTestId('appearance-custom-page').isVisible().catch(() => false)) return;
  if (!(await page.getByTestId('appearance-panel').isVisible().catch(() => false))) {
    await showToolbar(page);
    await page.getByTestId('appearance-button').click();
    await expect(page.getByTestId('appearance-panel')).toBeVisible();
  }
  await page.getByTestId('appearance-custom').click();
  await expect(page.getByTestId('appearance-custom-page')).toBeVisible();
}

/** 屏幕上现在有几栏正文：数窗口里可见的文字行，按左边缘聚类，只算至少 3 行的簇，相距不到 100px 的合并（首行缩进） */
function visibleColumns(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc;
    const frame = doc.defaultView!.frameElement as HTMLElement;
    const fx = frame.getBoundingClientRect().left;
    // 分页器把整章横向排成很多页，只有 #container（overflow 裁剪）里的那一页是看得见的
    let clip = { left: 0, right: window.innerWidth };
    for (let el = frame.parentElement; el; el = el.parentElement) {
      if (getComputedStyle(el).overflowX !== 'visible') {
        const b = el.getBoundingClientRect();
        clip = { left: Math.max(clip.left, b.left), right: Math.min(clip.right, b.right) };
      }
    }
    const xs: number[] = [];
    for (const p of Array.from(doc.querySelectorAll('p'))) {
      const range = doc.createRange();
      range.selectNodeContents(p);
      for (const r of Array.from(range.getClientRects())) {
        const x = fx + r.left;
        if (x >= clip.left - 1 && x < clip.right - 20 && r.width > 40) xs.push(Math.round(x / 6) * 6);
      }
    }
    const count = new Map<number, number>();
    for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1);
    // 首行缩进（2em）会让同一栏出现两个左边缘：相距不到 100px 的算同一栏
    const edges = [...count.entries()].filter(([, n]) => n >= 3).map(([x]) => x).sort((a, b) => a - b);
    let cols = 0;
    let last = -Infinity;
    for (const x of edges) {
      if (x - last > 100) cols++;
      last = x;
    }
    return cols;
  });
}

/** 正文第一个段落左边缘相对窗口的 x */
function firstTextLeft(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc;
    const el = doc.querySelector('h1, p')!;
    const r = doc.createRange();
    r.selectNodeContents(el);
    const frame = doc.defaultView!.frameElement as HTMLElement;
    return frame.getBoundingClientRect().left + r.getBoundingClientRect().left;
  });
}

function bodyStyle(page: Page, prop: string): Promise<string> {
  return page.evaluate((p) => {
    const doc = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc;
    return getComputedStyle(doc.body).getPropertyValue(p);
  }, prop);
}

const pLineHeight = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const doc = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc;
    return Math.round(parseFloat(getComputedStyle(doc.querySelector('p')!).lineHeight) * 10) / 10;
  });

const columnsChecked = async (page: Page): Promise<string | null> => {
  for (const id of ['auto', 'one', 'two']) {
    if ((await page.getByTestId(`columns-${id}`).getAttribute('aria-checked')) === 'true') return id;
  }
  return null;
};

test.describe('M5 字体与版式页', () => {
  test.use({ viewport: { width: 1280, height: 820 } });

  test('结构：标题“字体与版式”、字体和版式两组、没有“自定义”开关、滑块都可用、底部“恢复默认”', async ({ page }) => {
    await openReadingBook(page);
    await showToolbar(page);
    await page.getByTestId('appearance-button').click();
    // 第一页的入口按钮改名
    await expect(page.getByTestId('appearance-custom')).toHaveText('字体与版式');
    await page.getByTestId('appearance-custom').click();
    const pg = page.getByTestId('appearance-custom-page');
    await expect(pg.getByRole('heading', { name: '字体与版式' })).toBeVisible();
    // 两个组
    await expect(pg.locator('.ap-group-label')).toHaveText(['字体', '版式']);
    const groupStyle = await pg.locator('.ap-group-label').first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { size: cs.fontSize, color: cs.color };
    });
    expect(groupStyle.size).toBe('13px');
    // 字体组：字体、西文字体、字号、粗体文本
    await expect(pg.getByTestId('font-row')).toBeVisible();
    await expect(pg.getByTestId('west-row')).toBeVisible();
    await expect(pg.getByRole('slider', { name: '字号' })).toBeEnabled();
    await expect(pg.getByRole('switch', { name: '粗体文本' })).toBeVisible();
    // 版式组：栏数、行间距、页边距、字符间距、词间距、两端对齐
    await expect(pg.getByRole('radiogroup', { name: '栏数' })).toBeVisible();
    for (const name of ['行间距', '页边距', '字符间距', '词间距']) {
      await expect(pg.getByRole('slider', { name })).toBeEnabled();
    }
    await expect(pg.getByRole('slider', { name: '页边空白' })).toHaveCount(0);
    await expect(pg.getByRole('switch', { name: '两端对齐' })).toBeEnabled();
    await expect(pg.getByRole('switch', { name: '自定义' })).toHaveCount(0);
    await expect(pg.getByText('自定义', { exact: true })).toHaveCount(0);
    await expect(pg.getByTestId('appearance-reset')).toHaveText('恢复默认');
    // 页边距的数值是一位小数加 ×
    await expect(pg.getByText('1.0×', { exact: true })).toBeVisible();
    // 栏数分段控件：高 28，默认选中“自动”
    const seg = await pg.getByRole('radiogroup', { name: '栏数' }).boundingBox();
    expect(Math.round(seg!.height)).toBe(28);
    expect(await columnsChecked(page)).toBe('auto');
  });

  test('窗口矮时第二页内部滚动：面板最高“窗口高 - 100”，标题和返回固定在顶部', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 560 });
    await openReadingBook(page);
    await openLayoutPage(page);
    const panel = page.getByTestId('appearance-panel');
    const box = (await panel.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(560 - 100 + 1);
    const scroller = page.locator('.ap-custom-page .ap-scroll');
    const m = await scroller.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    expect(m.sh).toBeGreaterThan(m.ch + 20);
    await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
    // 滚到底，“恢复默认”可见；标题和“返回”还在
    await expect(page.getByTestId('appearance-reset')).toBeInViewport();
    await expect(page.getByRole('heading', { name: '字体与版式' })).toBeInViewport();
    await expect(page.locator('.ap-custom-page .ap-back')).toBeInViewport();
    const headTop = (await page.locator('.ap-custom-page .ap-head').boundingBox())!.y;
    expect(headTop).toBeGreaterThanOrEqual(box.y);
    expect(headTop).toBeLessThan(box.y + 40);
  });

  test('拖行间距：正文 p 的 line-height 跟着变（1.3、1.8、2.4）', async ({ page }) => {
    await openReadingBook(page);
    await openLayoutPage(page);
    const lh = page.getByRole('slider', { name: '行间距' });
    await lh.fill('1.3');
    await expect.poll(() => pLineHeight(page)).toBe(Math.round(18 * 1.3 * 10) / 10);
    await lh.fill('2.4');
    await expect.poll(() => pLineHeight(page)).toBe(Math.round(18 * 2.4 * 10) / 10);
    await lh.fill('1.8');
    await expect.poll(() => pLineHeight(page)).toBe(Math.round(18 * 1.8 * 10) / 10);
  });

  test('拖页边距：版心宽度跟着变（单栏窗口里 1.8× 变窄、0.5× 变宽；双栏里外边距变大）', async ({ page }) => {
    await openReadingBook(page);
    await openLayoutPage(page);
    // 双栏（1280 自动）：外边距 = 6.4% × 倍数
    const base = await firstTextLeft(page);
    expect(Math.abs(base - 0.064 * 1280)).toBeLessThan(8);
    await page.getByRole('slider', { name: '页边距' }).fill('1.8');
    await expect(page.getByText('1.8×', { exact: true })).toBeVisible();
    await expect.poll(() => firstTextLeft(page)).toBeGreaterThan(base + 40);
    await page.getByRole('slider', { name: '页边距' }).fill('0.5');
    await expect.poll(() => firstTextLeft(page)).toBeLessThan(base - 20);

    // 单栏（窗口 760 宽）：版心宽 = 760 × (1 - 2 × 6.4% × 倍数)
    await page.setViewportSize({ width: 760, height: 600 });
    await page.getByRole('slider', { name: '页边距' }).fill('1');
    await expect.poll(async () => Math.round(await firstTextLeft(page))).toBeCloseTo(0.064 * 760, -1);
    const one = await firstTextLeft(page);
    await page.getByRole('slider', { name: '页边距' }).fill('1.8');
    await expect.poll(() => firstTextLeft(page)).toBeGreaterThan(one + 30);
  });

  test('栏数：1280×820 自动是双栏；选单栏变一栏，再选双栏回两栏；设置刷新后还在', async ({ page }) => {
    await openReadingBook(page);
    await openLayoutPage(page);
    await expect.poll(() => visibleColumns(page)).toBe(2);
    await page.getByTestId('columns-one').click();
    await expect(page.getByTestId('columns-one')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => visibleColumns(page)).toBe(1);
    await expect(page.getByTestId('columns-hint')).toHaveCount(0);
    await page.getByTestId('columns-two').click();
    await expect.poll(() => visibleColumns(page)).toBe(2);
    await page.getByTestId('columns-auto').click();
    await expect.poll(() => visibleColumns(page)).toBe(2);

    // 关掉重开：设置还在
    await page.getByTestId('columns-one').click();
    await expect.poll(() => visibleColumns(page)).toBe(1);
    await page.waitForTimeout(500);
    await page.reload();
    await waitReaderReady(page);
    await expect.poll(() => visibleColumns(page)).toBe(1);
    await openLayoutPage(page);
    expect(await columnsChecked(page)).toBe('one');
  });

  test('900 宽窗口：自动是单栏，选“双栏”变两栏，没有提示', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await openReadingBook(page);
    await openLayoutPage(page);
    await expect.poll(() => visibleColumns(page)).toBe(1);
    await page.getByTestId('columns-two').click();
    await expect.poll(() => visibleColumns(page)).toBe(2);
    await expect(page.getByTestId('columns-hint')).toHaveCount(0);
    // 窗口缩到 600：窄于 640，退回单栏并出现提示
    await page.setViewportSize({ width: 600, height: 500 });
    await expect(page.getByTestId('columns-hint')).toHaveText('窗口太窄，暂时显示为单栏');
    await expect.poll(() => visibleColumns(page)).toBe(1);
    await page.setViewportSize({ width: 900, height: 700 });
    await expect(page.getByTestId('columns-hint')).toHaveCount(0);
    await expect.poll(() => visibleColumns(page)).toBe(2);
  });

  test('竖屏窗口选“双栏”：仍是单栏，分段控件下面出现提示', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 1100 });
    await openReadingBook(page);
    await openLayoutPage(page);
    await expect(page.getByTestId('columns-hint')).toHaveCount(0); // 自动：不显示
    await page.getByTestId('columns-two').click();
    await expect(page.getByTestId('columns-hint')).toHaveText('窗口太窄，暂时显示为单栏');
    await expect.poll(() => visibleColumns(page)).toBe(1);
    // 选单栏：不是“想双栏而不能”，提示消失
    await page.getByTestId('columns-one').click();
    await expect(page.getByTestId('columns-hint')).toHaveCount(0);
  });

  test('每次改动后阅读位置不跳（fraction 偏差 < 2%）：栏数、页边距、行间距、字符间距、词间距', async ({ page }) => {
    await openReadingBook(page, { long: true });
    await gotoSection(page, 5);
    await expectLocationChange(page, () => page.keyboard.press('ArrowRight'));
    await expectLocationChange(page, () => page.keyboard.press('ArrowRight'));
    await page.waitForTimeout(500);
    const before = (await currentLocation(page))!;
    expect(before.fraction).toBeGreaterThan(0.01);

    const same = async (label: string): Promise<void> => {
      await page.waitForTimeout(900);
      const after = (await currentLocation(page))!;
      expect(after.section, `${label}：章节`).toBe(before.section);
      expect(Math.abs(after.fraction - before.fraction), `${label}：fraction`).toBeLessThan(0.02);
    };

    await openLayoutPage(page);
    await page.getByTestId('columns-one').click();
    await expect.poll(() => visibleColumns(page)).toBe(1);
    await same('单栏');
    await page.getByTestId('columns-two').click();
    await expect.poll(() => visibleColumns(page)).toBe(2);
    await same('双栏');
    await page.getByRole('slider', { name: '页边距' }).fill('1.6');
    await same('页边距');
    await page.getByRole('slider', { name: '行间距' }).fill('2.2');
    await same('行间距');
    await page.getByRole('slider', { name: '字符间距' }).fill('0.1');
    await same('字符间距');
    await page.getByRole('slider', { name: '词间距' }).fill('0.4');
    await same('词间距');
    await page.getByTestId('columns-auto').click();
    await same('自动');
  });

  test('恢复默认：只还原这一页（字体、字号、粗体、栏数、版式），主题和页面模式不动', async ({ page }) => {
    await openReadingBook(page);
    await showToolbar(page);
    await page.getByTestId('appearance-button').click();
    await page.getByTestId('theme-calm').click();
    await page.getByRole('radio', { name: '深色' }).click();
    await page.getByTestId('appearance-custom').click();
    await page.getByTestId('columns-one').click();
    await page.getByRole('slider', { name: '行间距' }).fill('2.2');
    await page.getByRole('slider', { name: '页边距' }).fill('1.4');
    await page.getByRole('slider', { name: '字符间距' }).fill('0.08');
    await page.getByRole('slider', { name: '词间距' }).fill('0.3');
    await page.getByRole('slider', { name: '字号' }).fill('26');
    await page.getByRole('switch', { name: '粗体文本' }).click();
    await page.getByRole('switch', { name: '两端对齐' }).click();
    await expect.poll(() => bodyStyle(page, 'font-size')).toBe('26px');
    await expect.poll(() => visibleColumns(page)).toBe(1);

    await page.getByTestId('appearance-reset').click();
    await expect.poll(() => bodyStyle(page, 'font-size')).toBe('18px');
    await expect.poll(() => pLineHeight(page)).toBe(32.4);
    await expect.poll(() => bodyStyle(page, 'letter-spacing')).toBe('0.36px');
    await expect.poll(() => bodyStyle(page, 'word-spacing')).toBe('0px');
    await expect.poll(() => bodyStyle(page, 'font-weight')).toBe('400');
    await expect.poll(() => visibleColumns(page)).toBe(2);
    expect(await columnsChecked(page)).toBe('auto');
    await expect(page.getByRole('switch', { name: '两端对齐' })).toBeChecked();
    // 主题、页面模式没变
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page.getByTestId('theme-calm')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('radio', { name: '深色' })).toHaveAttribute('aria-checked', 'true');
  });

  test('旧存档迁移：custom=false 的行距等被重置；custom=true 的保留；非法 columns 退回自动', async ({ page }) => {
    const seed = (appearance: Record<string, unknown>): Promise<void> =>
      page.evaluate(
        (a) =>
          new Promise<void>((resolve, reject) => {
            const req = indexedDB.open('fjd');
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
              const tx = req.result.transaction('kv', 'readwrite');
              tx.objectStore('kv').put({ appearance: a }, 'settings');
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
            };
          }),
        appearance,
      );
    await openReadingBook(page);
    await page.goto('/');
    await seed({ custom: false, lineHeight: 2.4, letterSpacing: 0.1, margin: 1.8, columns: 'three' });
    await page.reload();
    await waitForCards(page, 1);
    await openCard(page, /打开《/);
    await expect.poll(() => pLineHeight(page)).toBe(32.4); // 1.8，不是 2.4
    await expect.poll(() => visibleColumns(page)).toBe(2); // 非法 columns → 自动
    await page.goto('/');
    await seed({ custom: true, lineHeight: 2.4, columns: 'one' });
    await page.reload();
    await waitForCards(page, 1);
    await openCard(page, /打开《/);
    await expect.poll(() => pLineHeight(page)).toBe(43.2);
    await expect.poll(() => visibleColumns(page)).toBe(1);
  });

  test('多个阅读窗口同步：一个窗口改了栏数和行距，另一个跟着变', async ({ page, context }) => {
    await openReadingBook(page);
    await waitReaderReady(page);
    const hash = new URL(page.url()).hash;
    const other = await context.newPage();
    await other.setViewportSize({ width: 1280, height: 820 });
    await other.goto(`/${hash}`);
    await waitReaderReady(other);
    await expect.poll(() => visibleColumns(other)).toBe(2);
    await page.bringToFront();
    await openLayoutPage(page);
    await page.getByTestId('columns-one').click();
    await page.getByRole('slider', { name: '行间距' }).fill('2');
    await expect.poll(() => visibleColumns(other)).toBe(1);
    await expect.poll(() => pLineHeight(other)).toBe(36);
    await other.close();
  });

  test('竖排书（关掉“竖排书改为横排”）：选单栏、双栏都不报错，照常显示', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await importBooks(page, [bookPath('tw-vertical.epub')]);
    await waitForCards(page, 1);
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
    const mode = await page.evaluate(() => {
      const doc = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc;
      return getComputedStyle(doc.body).writingMode;
    });
    expect(mode).toBe('vertical-rl');
    await openLayoutPage(page);
    for (const id of ['one', 'two', 'auto']) {
      await page.getByTestId(`columns-${id}`).click();
      await page.waitForTimeout(600);
      await expect(page.getByTestId('reader')).toHaveAttribute('data-status', 'ready');
    }
    await page.getByRole('slider', { name: '页边距' }).fill('1.5');
    await page.waitForTimeout(600);
    await expect(page.getByTestId('reader')).toHaveAttribute('data-status', 'ready');
    expect(errors).toEqual([]);
  });
});
