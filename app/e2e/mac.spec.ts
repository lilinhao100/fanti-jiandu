// M4：macOS 外观的“模拟 mac”验收。没有真 Mac，所以在浏览器里注入 window.__FJD_OS__ = 'mac' 打开 mac 模式，
// 红黄绿的位置用占位框画出来（真机上是系统按钮），确认：不画 Windows 窗口按钮、左工具栏让出 78px、快捷键改用 ⌘、
// 界面字体改成系统字体、字体页是 mac 的推荐列表。截图输出到 screenshots/M4/。
// 注意：这只证明渲染进程按 mac 分支走对了；红黄绿的真实位置、菜单栏、Dock 行为只能在真 Mac 上验证（见报告）。
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ROOT, importBooks, waitForCards, waitReaderReady } from './helpers';
import { openReadingBook } from './reading';
import { buildReadingBook } from './reading-book';

const OUT = path.join(ROOT, 'screenshots', 'M4');
const FIXTURE_FONT = path.join(ROOT, 'fixtures', 'fonts', 'NotoSerifSC-subset.ttf');

/** 红黄绿占位：三个 12px 圆点（x=17、y=20，间距 20px，和 main 进程的 trafficLightPosition 一致）+ 78px 让位区的虚线框 */
async function drawTrafficLights(page: Page, height: number): Promise<void> {
  await page.evaluate((h) => {
    document.getElementById('fjd-tl-placeholder')?.remove();
    const root = document.createElement('div');
    root.id = 'fjd-tl-placeholder';
    root.style.cssText = `position:fixed;left:0;top:0;width:78px;height:${h}px;z-index:2147483000;pointer-events:none;box-sizing:border-box;border:1px dashed rgba(255,59,48,.9);background:rgba(255,59,48,.06)`;
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;left:${17 + i * 20}px;top:20px;width:12px;height:12px;border-radius:50%;background:${c}`;
      root.append(d);
    });
    const label = document.createElement('div');
    label.textContent = '78px';
    label.style.cssText = 'position:absolute;left:2px;bottom:1px;font:9px monospace;color:rgba(255,59,48,.9)';
    root.append(label);
    document.body.append(root);
  }, height);
}

/** 所有可交互元素里，有多少个和占位区（x < 78，y < height）重叠 */
async function overlapping(page: Page, height: number): Promise<string[]> {
  return page.evaluate((h) => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, a, input, [role="button"], [role="menuitem"]')) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      // 工具栏隐藏时整条是 opacity:0 + pointer-events:none，不算
      if (el.closest('.toolbar:not(.visible)')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < 78 && r.top < h && r.right > 0 && r.bottom > 0) bad.push(`${el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? el.tagName} @${Math.round(r.left)},${Math.round(r.top)}`);
    }
    return bad;
  }, height);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test.describe('macOS 模式（模拟）', () => {
  test.use({ viewport: { width: 1144, height: 860 }, deviceScaleFactor: 1, colorScheme: 'light' });

  test.beforeEach(async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await page.addInitScript(() => {
      (window as unknown as { __FJD_OS__: string }).__FJD_OS__ = 'mac';
    });
  });

  test('书库：不画 Windows 窗口按钮；红黄绿区域没有可点的东西；界面字体是系统字体；菜单里是 ⌘O', async ({ page }) => {
    await page.goto('/');
    await importBooks(page, [{ name: 'reading.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(buildReadingBook(14)) }]);
    await waitForCards(page, 1);

    await expect(page.locator('html')).toHaveAttribute('data-os', 'mac');
    await expect(page.getByTestId('window-controls')).toHaveCount(0);
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(font).toContain('-apple-system');
    expect(font).toContain('PingFang SC');
    expect(font).not.toContain('Segoe');

    // 左上角 78×44 内（侧边栏顶部留给红黄绿的区域）没有任何可交互元素
    expect(await overlapping(page, 44)).toEqual([]);
    // 顶部拖动区还在（mac 上靠它拖动窗口、双击缩放）
    await expect(page.locator('.titlebar[data-tauri-drag-region]')).toHaveCount(1);

    await page.getByTestId('more-button').click();
    await expect(page.getByRole('menuitem', { name: /添加图书/ })).toContainText('⌘O');
    await page.keyboard.press('Escape');

    await drawTrafficLights(page, 44);
    await shot(page, 'library-mac');
  });

  test('书库：⌘O 打开文件选择器、⌘, 开设置、⌘F 无搜索；Ctrl 组合键不触发', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Control+,');
    await expect(page.getByTestId('settings')).toHaveCount(0);
    await page.keyboard.press('Meta+,');
    await expect(page.getByTestId('settings')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings')).toHaveCount(0);

    await importBooks(page, [{ name: 'reading.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(buildReadingBook(14)) }]);
    await waitForCards(page, 1);
    // 书库没有搜索：Ctrl+F、⌘F 都不应出现搜索框
    await page.keyboard.press('Control+f');
    await page.keyboard.press('Meta+f');
    await expect(page.getByTestId('search-input')).toHaveCount(0);
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await page.keyboard.press('Meta+o');
    await chooser;
  });

  test('阅读窗口：左工具栏让出 78px；按钮提示是 ⌘；⌘ 快捷键起作用、Ctrl 不起作用', async ({ page }) => {
    await openReadingBook(page);
    await expect(page.getByTestId('window-controls')).toHaveCount(0);

    await page.mouse.move(572, 30);
    await expect(page.getByTestId('toolbar')).toHaveClass(/visible/);
    // 左边第一个胶囊的左边缘 ≥ 12（工具栏内边距）+ 78
    const left = await page.locator('.tb-left .capsule').first().evaluate((el) => el.getBoundingClientRect().left);
    expect(left).toBeGreaterThanOrEqual(90 - 0.5);
    expect(await overlapping(page, 52)).toEqual([]);
    // 右边没有窗口按钮，右胶囊/书签钮贴着 12px 右边距
    const rightGap = await page.getByTestId('bookmark-button').evaluate((el) => window.innerWidth - el.getBoundingClientRect().right);
    expect(rightGap).toBeGreaterThanOrEqual(11.5);

    await expect(page.getByTestId('toc-button')).toHaveAttribute('title', '目录（⌘T）');
    await expect(page.getByTestId('bookmarks-button')).toHaveAttribute('title', '书签列表（⇧⌘D）');
    await expect(page.getByTestId('highlights-button')).toHaveAttribute('title', '要点精选（⇧⌘N）');
    await expect(page.getByTestId('search-button')).toHaveAttribute('title', '在书中搜索（⌘F）');
    await expect(page.getByTestId('script-toggle')).toHaveAttribute('title', /（⌘J）/);
    await expect(page.getByTestId('bookmark-button')).toHaveAttribute('title', '添加书签（⌘D）');

    await drawTrafficLights(page, 52);
    await shot(page, 'reader-mac');
    await page.evaluate(() => document.getElementById('fjd-tl-placeholder')?.remove());

    // ⌘T 开目录，Ctrl+T 不开
    await page.keyboard.press('Control+t');
    await expect(page.getByTestId('toc-panel')).toHaveCount(0);
    await page.keyboard.press('Meta+t');
    await expect(page.getByTestId('toc-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('toc-panel')).toHaveCount(0);
    // ⇧⌘D 书签列表、⇧⌘N 要点精选
    await page.keyboard.press('Meta+Shift+D');
    await expect(page.getByTestId('bookmark-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+Shift+N');
    await expect(page.getByTestId('highlights-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    // ⌘J 繁/简
    await expect(page.getByTestId('reader')).toHaveAttribute('data-display', 'converted');
    await page.keyboard.press('Control+j');
    await page.waitForTimeout(500);
    await expect(page.getByTestId('reader')).toHaveAttribute('data-display', 'converted');
    await page.keyboard.press('Meta+j');
    await expect(page.getByTestId('reader')).toHaveAttribute('data-display', 'original', { timeout: 30_000 });
    await waitReaderReady(page);
    await page.keyboard.press('Meta+j');
    await expect(page.getByTestId('reader')).toHaveAttribute('data-display', 'converted', { timeout: 30_000 });
    await waitReaderReady(page);
    // ⌘= / ⌘- / ⌘0 字号
    const fontSize = (): Promise<string> =>
      page.evaluate(() => getComputedStyle(window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc.body).getPropertyValue('font-size'));
    expect(await fontSize()).toBe('18px');
    await page.keyboard.press('Meta+=');
    await expect.poll(fontSize).toBe('20px');
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(400);
    expect(await fontSize()).toBe('20px');
    await page.keyboard.press('Meta+-');
    await expect.poll(fontSize).toBe('18px');
    await page.keyboard.press('Meta+=');
    await page.keyboard.press('Meta+0');
    await expect.poll(fontSize).toBe('18px');
  });

  test('字体页：mac 的推荐列表（宋体-简、苹方、楷体-简、圆体-简、冬青黑体）；默认字体是宋体-简；设置里的默认字体也是这一套', async ({ page }) => {
    await openReadingBook(page);
    await page.mouse.move(572, 30);
    await page.getByTestId('appearance-button').click();
    await page.getByTestId('appearance-custom').click();
    await expect(page.getByTestId('font-row')).toContainText('宋体-简');
    await page.getByTestId('font-row').click();
    const items = page.getByTestId('font-item');
    await expect(items.first()).toBeVisible();
    await expect(items.nth(0)).toContainText('原始');
    await expect(items.nth(1)).toContainText('宋体-简');
    await expect(items.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(items.nth(2)).toContainText('苹方');
    await expect(items.nth(3)).toContainText('楷体-简');
    await expect(items.nth(4)).toContainText('圆体-简');
    await expect(items.nth(5)).toContainText('冬青黑体');
    const text = await page.getByTestId('font-search').evaluate((el) => el.closest('[data-testid="appearance-panel"]')!.textContent ?? '');
    for (const winFont of ['微软雅黑', '等线']) expect(text).not.toContain(winFont);
    await page.mouse.move(300, 500);
    await shot(page, 'font-page-mac');
    // 正文用的是 Songti SC 的栈
    const family = await page.evaluate(() => getComputedStyle(window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc.body).fontFamily);
    expect(family).toContain('Songti SC');
    expect(family).not.toContain('SimSun');

    // 选苹方 → 正文栈变成 PingFang SC
    await items.nth(2).click();
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc.body).fontFamily))
      .toContain('PingFang SC');

    // 导入一个字体，“我导入的”组出现在推荐后面
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('font-import').click();
    await (await chooser).setFiles(FIXTURE_FONT);
    await expect(page.getByText('我导入的', { exact: true })).toBeVisible();
    await page.mouse.move(300, 500);
    await shot(page, 'font-page-mac-imported');
  });

  test('字体页：系统里没装的 Apple 字体不显示（模拟一份没有圆体、冬青黑体的系统字体列表）', async ({ page, context }) => {
    await context.grantPermissions(['local-fonts']);
    await page.addInitScript(() => {
      const fam = ['Songti SC', 'PingFang SC', 'Kaiti SC', 'Helvetica Neue', 'Georgia', ...Array.from({ length: 30 }, (_, i) => `Filler Font ${i}`)];
      // 假的 FontData：blob 读不出字体表，web 版会凭家族名猜
      (window as unknown as { queryLocalFonts: () => Promise<unknown[]> }).queryLocalFonts = async () =>
        fam.map((f) => ({ family: f, fullName: f, postscriptName: f.replace(/ /g, '-'), style: 'Regular', blob: async () => new Blob(['x']) }));
    });
    await openReadingBook(page);
    await page.mouse.move(572, 30);
    await page.getByTestId('appearance-button').click();
    await page.getByTestId('appearance-custom').click();
    await page.getByTestId('font-row').click();
    await expect(page.getByText('系统字体', { exact: true })).toBeVisible({ timeout: 30_000 });
    const recommended = await page.getByTestId('font-item').evaluateAll((els) => els.slice(0, 6).map((e) => e.textContent ?? ''));
    expect(recommended.some((t) => t.includes('宋体-简'))).toBe(true);
    expect(recommended.some((t) => t.includes('苹方'))).toBe(true);
    expect(recommended.some((t) => t.includes('楷体-简'))).toBe(true);
    expect(recommended.some((t) => t.includes('圆体-简'))).toBe(false);
    expect(recommended.some((t) => t.includes('冬青黑体'))).toBe(false);
    // 装了的推荐字体不在“系统字体”里重复出现
    await page.getByTestId('font-search').fill('Songti');
    await expect(page.getByTestId('font-item')).toHaveCount(1);
  });
});
