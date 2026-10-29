// M2b：阅读窗口的外观与导航（工具栏、版心、主题与设置面板、目录、书签、搜索、快捷键）
import { expect, test, type Page } from '@playwright/test';
import { currentLocation, expectLocationChange, waitReaderReady } from './helpers';
import { openReadingBook } from './reading';
import { READING_TITLE_SC } from './reading-book';

async function showToolbar(page: Page): Promise<void> {
  const w = page.viewportSize()!.width;
  await page.mouse.move(w / 2, 30);
  await expect(page.getByTestId('toolbar')).toHaveClass(/visible/);
}

async function openAppearance(page: Page): Promise<void> {
  await showToolbar(page);
  await page.getByTestId('appearance-button').click();
  await expect(page.getByTestId('appearance-panel')).toBeVisible();
}

/** 正文 iframe 里 body 的计算样式 */
function bodyStyle(page: Page, prop: string): Promise<string> {
  return page.evaluate((p) => {
    const doc = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc;
    return getComputedStyle(doc.body).getPropertyValue(p);
  }, prop);
}

/** 正文里第一个标题（或段落）左边缘相对窗口的 x（iframe 的位置 + 元素在 iframe 里的位置） */
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

test.describe('阅读窗口：版心、工具栏、窗口标题', () => {
  test.use({ viewport: { width: 1144, height: 860 } });

  test('双页：外边距 6.4%（73px）；窗口标题是简体书名', async ({ page }) => {
    await openReadingBook(page);
    await expect(page).toHaveTitle(READING_TITLE_SC);
    await expect(page.getByTestId('book-title')).toHaveText(READING_TITLE_SC);
    // 第一章第一页：标题（左栏）起点就是左外边距
    await page.waitForTimeout(500);
    expect(await firstTextLeft(page)).toBeCloseTo(73.2, -1); // ±5px
    const left = await firstTextLeft(page);
    expect(Math.abs(left - 73.2)).toBeLessThan(3);
    // 上边距 72：正文第一行的顶部不早于 72
    const top = await page.evaluate(() => {
      const doc = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc;
      const r = doc.createRange();
      r.selectNodeContents(doc.querySelector('h1, p')!);
      return (doc.defaultView!.frameElement as HTMLElement).getBoundingClientRect().top + r.getBoundingClientRect().top;
    });
    expect(top).toBeGreaterThanOrEqual(70);
    expect(top).toBeLessThan(120);
  });

  test('窗口宽度 800：单页，版心 680 水平居中（外边距 60）', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 860 });
    await openReadingBook(page);
    await page.waitForTimeout(500);
    const left = await firstTextLeft(page);
    expect(Math.abs(left - 60)).toBeLessThan(3);
  });

  test('工具栏：左胶囊三个按钮、书名、右胶囊（繁/简、大小、搜索）、书签圆钮、窗口按钮；窗口按钮随工具栏显示和隐藏', async ({ page }) => {
    await openReadingBook(page);
    const bar = page.getByTestId('toolbar');
    await expect(bar).not.toHaveClass(/visible/);
    await showToolbar(page);
    for (const name of ['目录', '书签列表', '要点精选', '主题与设置', '搜索', '添加书签']) {
      await expect(bar.getByRole('button', { name })).toBeVisible();
    }
    await expect(bar.getByTestId('script-toggle')).toHaveText('简');
    await expect(bar.getByTestId('window-controls')).toBeVisible();
    for (const name of ['最小化', '最大化', '关闭']) await expect(bar.getByRole('button', { name })).toBeVisible();
    // “大小”按钮显示文字
    await expect(bar.getByTestId('appearance-button')).toContainText('大小');
    // 窗口按钮 46×32，贴着窗口右上角
    await page.waitForTimeout(400); // 等工具栏的出现动画走完
    const box = await bar.getByRole('button', { name: '关闭' }).boundingBox();
    expect(box!.width).toBeCloseTo(46, 0);
    expect(box!.height).toBeCloseTo(32, 0);
    expect(Math.round(box!.x + box!.width)).toBe(1144);
    expect(Math.round(box!.y)).toBe(0);
    // 隐藏后窗口按钮也不可点（随工具栏一起隐藏）
    await page.mouse.move(600, 420);
    await expect(bar).not.toHaveClass(/visible/, { timeout: 4000 });
    await expect(bar).toHaveAttribute('aria-hidden', 'true');
  });
});

test.describe('主题与设置', () => {
  test.use({ viewport: { width: 1144, height: 860 } });

  test('改字号后位置不跳：同一章，fraction 差 < 2%（小A/大A 与 Ctrl+= / Ctrl+- / Ctrl+0）', async ({ page }) => {
    await openReadingBook(page, { long: true });
    // 走到第 6 章中间
    await page.evaluate(() => window.__fjd!.controller.debug.view!.goTo(5));
    await expect.poll(async () => (await currentLocation(page))?.section).toBe(5);
    await expectLocationChange(page, () => page.keyboard.press('ArrowRight'));
    await page.waitForTimeout(500);
    const before = (await currentLocation(page))!;
    expect(before.fraction).toBeGreaterThan(0.01);

    const sameSpot = async (label: string): Promise<void> => {
      await page.waitForTimeout(900);
      const after = (await currentLocation(page))!;
      expect(after.section, `${label}：章节`).toBe(before.section);
      expect(Math.abs(after.fraction - before.fraction), `${label}：fraction`).toBeLessThan(0.02);
    };

    await openAppearance(page);
    const fontSize = (): Promise<string> => bodyStyle(page, 'font-size');
    expect(await fontSize()).toBe('18px');
    await page.getByRole('button', { name: '增大字号' }).click();
    await page.getByRole('button', { name: '增大字号' }).click();
    await expect.poll(fontSize).toBe('22px');
    await sameSpot('大A ×2');
    await page.getByRole('button', { name: '减小字号' }).click();
    await expect.poll(fontSize).toBe('20px');
    await sameSpot('小A');
    await page.keyboard.press('Escape');

    await page.keyboard.press('Control+=');
    await expect.poll(fontSize).toBe('22px');
    await sameSpot('Ctrl+=');
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+-');
    await expect.poll(fontSize).toBe('18px');
    await sameSpot('Ctrl+-');
    await page.keyboard.press('Control+=');
    await expect.poll(fontSize).toBe('20px');
    await page.keyboard.press('Control+0');
    await expect.poll(fontSize).toBe('18px');
    await sameSpot('Ctrl+0');

    // 切主题、改行距也不跳
    await openAppearance(page);
    await page.getByTestId('theme-bold').click();
    await sameSpot('主题');
    await page.getByTestId('appearance-custom').click();
    await page.getByRole('switch', { name: '自定义' }).click();
    await page.getByRole('slider', { name: '行间距' }).fill('2.4');
    await sameSpot('行间距');
  });

  test('主题切换后刷新仍然保持：六个主题的配色，换了立刻生效', async ({ page }) => {
    await openReadingBook(page);
    const bgOf = (): Promise<string> => bodyStyle(page, 'background-color');
    const colors: Record<string, string> = {
      quiet: 'rgb(74, 74, 77)',
      paper: 'rgb(238, 237, 237)',
      bold: 'rgb(255, 255, 255)',
      calm: 'rgb(240, 226, 201)',
      focus: 'rgb(255, 252, 244)',
      original: 'rgb(255, 255, 255)',
    };
    await openAppearance(page);
    for (const [id, rgb] of Object.entries(colors)) {
      await page.getByTestId(`theme-${id}`).click();
      await expect.poll(bgOf).toBe(rgb);
      await expect(page.getByTestId(`theme-${id}`)).toHaveAttribute('aria-checked', 'true');
    }
    await page.getByTestId('theme-calm').click();
    await expect.poll(bgOf).toBe(colors.calm);
    // 窗口背景（页边）也是主题色
    await expect(page.getByTestId('reader')).toHaveCSS('background-color', colors.calm!);

    await page.reload();
    await waitReaderReady(page);
    await expect.poll(bgOf).toBe(colors.calm);
    await expect(page.getByTestId('reader')).toHaveCSS('background-color', colors.calm!);
    await openAppearance(page);
    await expect(page.getByTestId('theme-calm')).toHaveAttribute('aria-checked', 'true');
  });

  test('粗体主题用微软雅黑 700；自选字体覆盖主题字体；还原主题', async ({ page }) => {
    await openReadingBook(page);
    await openAppearance(page);
    await page.getByTestId('theme-bold').click();
    await expect.poll(() => bodyStyle(page, 'font-weight')).toBe('700');
    expect(await bodyStyle(page, 'font-family')).toContain('Microsoft YaHei');
    await page.getByTestId('appearance-custom').click();
    await page.getByTestId('font-row').click(); // M2d：字体是自定义页里的一项，点进去是字体页
    await page.getByRole('radio', { name: '楷体' }).click();
    await expect.poll(() => bodyStyle(page, 'font-family')).toContain('KaiTi');
    await page.getByTestId('font-back').click();
    await page.getByTestId('appearance-reset').click();
    await expect.poll(() => bodyStyle(page, 'font-family')).toContain('Microsoft YaHei');
    // 粗体文本开关
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByTestId('theme-original').click();
    await expect.poll(() => bodyStyle(page, 'font-weight')).toBe('400');
    await page.getByTestId('appearance-custom').click();
    await page.getByRole('switch', { name: '粗体文本' }).click();
    await expect.poll(() => bodyStyle(page, 'font-weight')).toBe('700');
  });

  test('自定义：开关关闭时滑块是灰的；打开后行距、字符间距、页边空白立刻作用到正文', async ({ page }) => {
    await openReadingBook(page);
    await openAppearance(page);
    await page.getByTestId('appearance-custom').click();
    const lh = page.getByRole('slider', { name: '行间距' });
    await expect(lh).toBeDisabled();
    await page.getByRole('switch', { name: '自定义' }).click();
    await expect(lh).toBeEnabled();
    await lh.fill('2.4');
    await expect.poll(() => page.evaluate(() => {
      const doc = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc;
      return Math.round(parseFloat(getComputedStyle(doc.querySelector('p')!).lineHeight) * 10);
    })).toBe(Math.round(18 * 2.4 * 10));
    await page.getByRole('slider', { name: '字符间距' }).fill('0.1');
    await expect.poll(() => bodyStyle(page, 'letter-spacing')).toBe('1.8px');
    // 页边空白 1.8×：外边距变大
    const before = await firstTextLeft(page);
    await page.getByRole('slider', { name: '页边空白' }).fill('1.8');
    await expect.poll(() => firstTextLeft(page)).toBeGreaterThan(before + 40);
    // 两端对齐
    await page.getByRole('switch', { name: '两端对齐' }).click();
    await expect.poll(() => page.evaluate(() => {
      const doc = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc;
      return getComputedStyle(doc.querySelector('p')!).textAlign;
    })).toMatch(/start|left/);
    // 还原
    await page.getByTestId('appearance-reset').click();
    await expect.poll(() => bodyStyle(page, 'letter-spacing')).toBe('0.36px');
    await expect(lh).toBeDisabled();
  });

  test('页面模式三个按钮：浅色、深色、自动；设置刷新后还在', async ({ page }) => {
    await openReadingBook(page);
    await openAppearance(page);
    await page.getByRole('radio', { name: '深色' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => bodyStyle(page, 'background-color')).toBe('rgb(0, 0, 0)');
    await page.getByRole('radio', { name: '浅色' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => bodyStyle(page, 'background-color')).toBe('rgb(255, 255, 255)');
    await page.getByRole('radio', { name: '深色' }).click();
    await page.reload();
    await waitReaderReady(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => bodyStyle(page, 'background-color')).toBe('rgb(0, 0, 0)');
  });

  test('面板：点外面或按 Esc 关闭；点页面只关面板不翻页', async ({ page }) => {
    await openReadingBook(page);
    await openAppearance(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('appearance-panel')).toHaveCount(0);

    await openAppearance(page);
    const before = await currentLocation(page);
    await page.mouse.click(1000, 600); // 右三分之一的页面
    await expect(page.getByTestId('appearance-panel')).toHaveCount(0);
    await page.waitForTimeout(500);
    expect((await currentLocation(page))?.cfi).toBe(before?.cfi);
    // 再点一次才翻页
    await expectLocationChange(page, () => page.mouse.click(1000, 600));
  });
});

test.describe('目录、书签、搜索', () => {
  test.use({ viewport: { width: 1144, height: 860 } });

  test('目录：当前章节加粗并带蓝点，点击跳转，“返回”按钮上是跳转前的页码', async ({ page }) => {
    await openReadingBook(page);
    await expectLocationChange(page, () => page.keyboard.press('ArrowRight'));
    const here = (await page.getByTestId('page-position').textContent())!.split('/')[0]!.trim();
    await page.keyboard.press('Control+t');
    const panel = page.getByTestId('toc-panel');
    await expect(panel.locator('.toc-item')).toHaveCount(12);
    await expect(panel.locator('.toc-item.current')).toHaveText('第一章　初到江南');
    await panel.locator('.toc-item', { hasText: '第五章' }).click();
    await expect(panel).toHaveCount(0);
    await expect.poll(async () => (await currentLocation(page))?.section).toBe(4);
    await expect(page.getByTestId('back-button')).toContainText(here);
    await page.keyboard.press('Control+t');
    await expect(page.getByTestId('toc-panel').locator('.toc-item.current')).toHaveText('第五章　一封旧信');
    await page.keyboard.press('Escape');
    await page.getByTestId('back-button').click();
    await expect.poll(async () => (await currentLocation(page))?.section).toBe(0);
    await expect(page.getByTestId('back-button')).toHaveCount(0);
  });

  test('Ctrl+D 加书签：按钮变实心，书签面板里出现；再按 Ctrl+D 删除；刷新后还在', async ({ page }) => {
    await openReadingBook(page);
    await expectLocationChange(page, () => page.keyboard.press('ArrowRight'));
    const btn = page.getByTestId('bookmark-button');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(btn).toHaveAttribute('aria-label', '添加书签');
    await page.keyboard.press('Control+d');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(btn).toHaveAttribute('aria-label', '删除书签');

    await page.keyboard.press('Control+Shift+d');
    const panel = page.getByTestId('bookmark-panel');
    await expect(panel).toBeVisible();
    const items = panel.getByTestId('bookmark-item');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('第一章');
    await expect(items.first()).toContainText(/\d{4}\/\d+\/\d+/);
    await page.keyboard.press('Escape');

    // 翻到别的页：空心；翻回来：实心
    await expectLocationChange(page, () => page.keyboard.press('ArrowRight'));
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expectLocationChange(page, () => page.keyboard.press('ArrowLeft'));
    await expect(btn).toHaveAttribute('aria-pressed', 'true');

    // 刷新后书签还在，点书签条目回到那一页
    await page.reload();
    await waitReaderReady(page);
    await expectLocationChange(page, () => page.keyboard.press('ArrowRight'));
    await expectLocationChange(page, () => page.keyboard.press('ArrowRight'));
    await page.keyboard.press('Control+Shift+d');
    await expect(page.getByTestId('bookmark-item')).toHaveCount(1);
    await page.getByTestId('bookmark-item').first().locator('.bm-main').click();
    await expect(page.getByTestId('bookmark-panel')).toHaveCount(0);
    await expect(btn).toHaveAttribute('aria-pressed', 'true');

    // 再按 Ctrl+D 删除；面板里没有了
    await page.keyboard.press('Control+d');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Control+Shift+d');
    await expect(page.getByTestId('bookmark-item')).toHaveCount(0);
    await expect(page.getByTestId('bookmark-panel')).toContainText('还没有书签');
  });

  test('书签面板：悬停出现删除按钮', async ({ page }) => {
    await openReadingBook(page);
    await page.keyboard.press('Control+d');
    await page.keyboard.press('Control+Shift+d');
    const item = page.getByTestId('bookmark-item').first();
    await item.hover();
    await item.getByRole('button', { name: '删除书签' }).click();
    await expect(page.getByTestId('bookmark-item')).toHaveCount(0);
    await expect(page.getByTestId('bookmark-button')).toHaveAttribute('aria-pressed', 'false');
  });

  test('搜索“认真”：有结果、按章节分组、匹配词加粗；繁体“認真”结果相同；点击跳转并闪烁高亮', async ({ page }) => {
    await openReadingBook(page);
    await page.keyboard.press('Control+f');
    const input = page.getByTestId('search-input');
    await expect(input).toBeFocused();
    await input.fill('认真');
    const hits = page.getByTestId('search-hit');
    await expect(hits.first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('正在搜索…')).toHaveCount(0, { timeout: 20_000 });
    const n = await hits.count();
    expect(n).toBeGreaterThan(3);
    // 结果按章节分组，组名是章名
    const groups = page.getByTestId('search-group');
    expect(await groups.count()).toBeGreaterThan(1);
    await expect(groups.first().locator('.sp-chapter')).toHaveText('第一章　初到江南');
    // 匹配词加粗，显示的是简体
    await expect(hits.first().locator('b')).toHaveText('认真');

    // 输入繁体：同样多的结果
    await input.fill('認真');
    await expect(page.getByText('正在搜索…')).toHaveCount(0, { timeout: 20_000 });
    await expect(hits).toHaveCount(n);
    await expect(hits.first().locator('b')).toHaveText('认真');

    // 跳转：位置变化、面板关闭、返回按钮出现、命中处闪烁高亮 1.2 秒后消失
    const before = await currentLocation(page);
    await hits.nth(Math.min(n - 1, 8)).click();
    await expect(page.getByTestId('search-panel')).toHaveCount(0);
    await expect.poll(async () => (await currentLocation(page))?.cfi).not.toBe(before?.cfi);
    await expect(page.getByTestId('back-button')).toBeVisible();
    const flashing = (): Promise<number> =>
      page.evaluate(() => {
        const c = window.__fjd!.controller.debug.view!.renderer.getContents()[0] as unknown as { overlayer: { element: SVGElement } };
        // 闪烁高亮：overlayer 的 svg 里有 fill 为 #FFDC00 的 <g>
        return c.overlayer.element.querySelectorAll('g[fill="#FFDC00"]').length;
      });
    expect(await flashing()).toBeGreaterThan(0);
    await expect.poll(flashing, { timeout: 4000 }).toBe(0);
    // 跳到的那一页确实含“认真”
    const visible = await page.evaluate(() => {
      const v = window.__fjd!.controller.debug.view!;
      return v.lastLocation && (v.lastLocation as unknown as { range: Range }).range.toString();
    });
    expect(visible).toContain('认真');

    // 关掉面板再打开：上次的结果还在
    await page.keyboard.press('Control+f');
    await expect(page.getByTestId('search-input')).toHaveValue('認真');
    await expect(page.getByTestId('search-hit')).toHaveCount(n);
    // 清空输入：结果消失
    await page.getByTestId('search-input').fill('');
    await expect(page.getByTestId('search-hit')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('search-panel')).toHaveCount(0);
  });

  test('搜索没有结果时提示；在输入框里按方向键不翻页', async ({ page }) => {
    await openReadingBook(page);
    await page.keyboard.press('Control+f');
    const before = await currentLocation(page);
    await page.getByTestId('search-input').fill('不存在的词语');
    await expect(page.getByTestId('search-panel')).toContainText('没有找到“不存在的词语”');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600);
    expect((await currentLocation(page))?.cfi).toBe(before?.cfi);
  });
});

test.describe('快捷键', () => {
  test.use({ viewport: { width: 1144, height: 860 } });

  test('Alt+↑ / Alt+↓：章首、章末；Alt+→ / Alt+←：上一章、下一章', async ({ page }) => {
    await openReadingBook(page);
    await page.keyboard.press('Alt+ArrowRight');
    await expect.poll(async () => (await currentLocation(page))?.section).toBe(1);
    await page.waitForTimeout(500);
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(async () => (await page.getByTestId('pages-left').textContent())).toBe('本章还剩 0 页');
    expect((await currentLocation(page))?.section).toBe(1);
    await page.waitForTimeout(500);
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(async () => (await page.getByTestId('pages-left').textContent())).not.toBe('本章还剩 0 页');
    await page.waitForTimeout(500);
    await page.keyboard.press('Alt+ArrowLeft');
    await expect.poll(async () => (await currentLocation(page))?.section).toBe(0);
  });

  test('Ctrl+W 关闭窗口（web 版回到书库）；Ctrl+O 打开文件选择器；Ctrl+, 打开设置', async ({ page }) => {
    await openReadingBook(page);
    await page.keyboard.press('Control+,');
    await expect(page.getByTestId('settings')).toBeVisible();
    await page.keyboard.press('Control+,');
    await expect(page.getByTestId('settings')).toHaveCount(0);
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Control+o');
    await chooser;
    await page.keyboard.press('Control+w');
    await expect(page.getByTestId('library')).toBeVisible();
  });

  test('繁/简：书本身是繁体，Ctrl+J 切换后按钮显示“繁”，位置不跳', async ({ page }) => {
    await openReadingBook(page);
    await expectLocationChange(page, () => page.keyboard.press('ArrowRight'));
    const before = await currentLocation(page);
    await page.keyboard.press('Control+j');
    await expect(page.getByTestId('script-toggle')).toHaveText('繁');
    await waitReaderReady(page);
    const after = await currentLocation(page);
    expect(after!.section).toBe(before!.section);
    expect(Math.abs(after!.fraction - before!.fraction)).toBeLessThan(0.02);
  });
});
