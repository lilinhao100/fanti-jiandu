// M2d：阅读字体随意调整（web 版）
// 导入开源字体（fixtures/fonts，OFL）→ 选中后正文生效 → 刷新仍在 → 删除后退回宋体并提示；
// 搜索过滤、西文字体、字号滑块与档位按钮、多标签页同步、本机字体（queryLocalFonts，有授权才测）。
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { currentLocation, ROOT, waitReaderReady } from './helpers';
import { openReadingBook } from './reading';

const FIXTURE_FONT = path.join(ROOT, 'fixtures', 'fonts', 'NotoSerifSC-subset.ttf');
const FAMILY = 'Noto Serif SC';

async function showToolbar(page: Page): Promise<void> {
  const w = page.viewportSize()!.width;
  await page.mouse.move(w / 2, 30);
  await expect(page.getByTestId('toolbar')).toHaveClass(/visible/);
}

async function openFontPage(page: Page, which: 'font-row' | 'west-row' = 'font-row'): Promise<void> {
  if (!(await page.getByTestId('appearance-panel').isVisible().catch(() => false))) {
    await showToolbar(page);
    await page.getByTestId('appearance-button').click();
    await expect(page.getByTestId('appearance-panel')).toBeVisible();
  }
  if (!(await page.getByTestId('appearance-custom-page').isVisible().catch(() => false))) {
    await page.getByTestId('appearance-custom').click();
  }
  await page.getByTestId(which).click();
  await expect(page.getByTestId('font-page')).toBeVisible();
}

async function importFixture(page: Page): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('font-import').click();
  await (await chooser).setFiles(FIXTURE_FONT);
}

/** 正文 iframe 里 body 的计算样式 */
function bodyStyle(page: Page, prop: string): Promise<string> {
  return page.evaluate((p) => {
    const doc = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc;
    return getComputedStyle(doc.body).getPropertyValue(p);
  }, prop);
}

/** 计算出的 font-family 去掉引号（浏览器只在名字里有空格时才加引号），便于按栈的顺序比较 */
async function stack(page: Page): Promise<string> {
  return (await bodyStyle(page, 'font-family')).replace(/"/g, '');
}

/** 这个字体在正文 iframe 里是不是真的加载并用上了（不只是 font-family 写对了） */
function fontLoadedInReader(page: Page, family: string): Promise<boolean> {
  return page.evaluate(async (fam) => {
    const doc = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc;
    await doc.fonts.ready;
    return doc.fonts.check(`18px "${fam}"`, '繁体简读') && [...doc.fonts].some((f) => f.family.replace(/"/g, '') === fam && f.status === 'loaded');
  }, family);
}

const item = (page: Page, name: string | RegExp) => page.getByTestId('font-item').filter({ hasText: name });

test.describe('字体：导入、选用、刷新、删除', () => {
  test('导入 ttf → 选中后正文用它 → 刷新仍在 → 删除后退回宋体并提示', async ({ page }) => {
    await openReadingBook(page, { long: true });
    await openFontPage(page);

    // 导入前：推荐里有原始和 4 个推荐字体，没有“我导入的”
    await expect(page.getByTestId('font-item').first()).toContainText('原始');
    await expect(page.getByText('我导入的')).toHaveCount(0);

    await importFixture(page);
    await expect(page.getByText('我导入的', { exact: true })).toBeVisible();
    const imported = item(page, FAMILY);
    await expect(imported).toBeVisible();
    await expect(imported).toContainText('繁体简读 Aa');
    // 列表里这一项自己的名字就是用这个字体画的
    await expect(imported.locator('.fp-name')).toHaveCSS('font-family', /Noto Serif SC/);

    const before = await currentLocation(page);
    await imported.click();
    await expect(imported).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => bodyStyle(page, 'font-family')).toContain(FAMILY);
    expect(await bodyStyle(page, 'font-family')).toContain(`"${FAMILY}"`);
    await expect.poll(() => fontLoadedInReader(page, FAMILY)).toBe(true);
    // 阅读位置不跳
    const after = await currentLocation(page);
    expect(after!.cfi.split('!')[0]).toBe(before!.cfi.split('!')[0]);
    expect(Math.abs(after!.fraction - before!.fraction)).toBeLessThan(0.02);

    // 自定义页的“字体”一行显示它的名字
    await page.getByTestId('font-back').click();
    await expect(page.getByTestId('font-row')).toContainText(FAMILY);

    // 刷新后仍然生效，字体文件也重新加载了
    await page.reload();
    await waitReaderReady(page);
    await expect.poll(() => bodyStyle(page, 'font-family')).toContain(FAMILY);
    await expect.poll(() => fontLoadedInReader(page, FAMILY)).toBe(true);

    // 删除：悬停显示删除按钮，点掉后正文退回宋体，面板里提示一次
    await openFontPage(page);
    const row = item(page, FAMILY);
    await expect(row).toHaveAttribute('aria-checked', 'true');
    await row.hover();
    const del = page.getByTestId('font-delete');
    await expect(del).toBeVisible();
    await del.click();
    await expect(page.getByTestId('font-notice')).toHaveText(new RegExp(`字体 ${FAMILY} 不可用，已改用宋体`));
    await expect.poll(() => bodyStyle(page, 'font-family')).toContain('SimSun');
    expect(await bodyStyle(page, 'font-family')).not.toContain(FAMILY);
    await expect(item(page, FAMILY)).toHaveCount(0);
    await expect(page.getByText('我导入的')).toHaveCount(0);
    await expect(item(page, '宋体')).toHaveAttribute('aria-checked', 'true');

    // 刷新后仍是宋体，数据里也没有这个字体了
    await page.reload();
    await waitReaderReady(page);
    await expect.poll(() => bodyStyle(page, 'font-family')).toContain('SimSun');
    const left = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const req = indexedDB.open('fjd');
          req.onsuccess = () => {
            const c = req.result.transaction('fonts').objectStore('fonts').count();
            c.onsuccess = () => resolve(c.result);
          };
        }),
    );
    expect(left).toBe(0);
  });

  test('导入的字体在书库设置的“默认字体”里也看得到；不是字体的文件报错', async ({ page }) => {
    await openReadingBook(page);
    await openFontPage(page);
    // 不是字体：提示错误，不会添加任何东西
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('font-import').click();
    await (await chooser).setFiles({ name: 'fake.ttf', mimeType: 'font/ttf', buffer: Buffer.from('this is not a font') });
    await expect(page.getByTestId('font-notice')).toContainText('不是有效的字体文件');
    await expect(page.getByText('我导入的')).toHaveCount(0);

    await importFixture(page);
    await item(page, FAMILY).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+,');
    await page.getByRole('button', { name: '阅读' }).click();
    await expect(page.getByRole('radio', { name: new RegExp(FAMILY) })).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('字体页：搜索、分组、虚拟滚动', () => {
  test('搜索框按中文名或英文名过滤；清空后恢复；没有结果有提示', async ({ page }) => {
    await openReadingBook(page);
    await openFontPage(page);
    await importFixture(page);
    await expect(item(page, FAMILY)).toBeVisible();

    const search = page.getByTestId('font-search');
    await search.fill('楷');
    await expect(page.getByTestId('font-item')).toHaveCount(1);
    await expect(page.getByTestId('font-item')).toContainText('楷体');
    await expect(page.getByText('我导入的')).toHaveCount(0);

    await search.fill('noto');
    await expect(page.getByTestId('font-item')).toHaveCount(1);
    await expect(page.getByTestId('font-item')).toContainText(FAMILY);

    await search.fill('yahei');
    await expect(page.getByTestId('font-item')).toHaveCount(1);
    await expect(page.getByTestId('font-item')).toContainText('微软雅黑');

    await search.fill('zzzzzz');
    await expect(page.getByTestId('font-item')).toHaveCount(0);
    await expect(page.getByTestId('font-list')).toContainText('没有找到字体');

    await page.getByRole('button', { name: '清除搜索' }).click();
    await expect(page.getByTestId('font-item').first()).toContainText('原始');
    // Enter 选中第一个搜索结果
    await search.fill('等线');
    await search.press('Enter');
    await expect.poll(() => bodyStyle(page, 'font-family')).toContain('DengXian');
  });

  test('列表很长时只渲染看得见的行（虚拟滚动）；滚动后能点到最后一项', async ({ page, context }) => {
    // 造 400 个字体：mock queryLocalFonts，不读真实的字体文件
    await context.addInitScript(() => {
      const fonts = Array.from({ length: 400 }, (_, i) => ({
        family: `Fake Family ${String(i).padStart(3, '0')}`,
        fullName: `Fake Family ${i}`,
        postscriptName: `Fake${i}`,
        style: 'Regular',
        blob: async () => new Blob([]),
      }));
      (window as unknown as { queryLocalFonts: () => Promise<unknown> }).queryLocalFonts = async () => fonts;
      const perms = navigator.permissions;
      const orig = perms.query.bind(perms);
      perms.query = (d: PermissionDescriptor) =>
        (d as { name: string }).name === 'local-fonts' ? Promise.resolve({ state: 'granted' } as PermissionStatus) : orig(d);
    });
    await openReadingBook(page);
    await openFontPage(page);
    await expect(page.getByText('系统字体', { exact: true })).toBeVisible({ timeout: 15_000 });
    // DOM 里的字体行远少于 400
    const rendered = await page.getByTestId('font-item').count();
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(40);
    // 滚到底，最后一项出现并可以选
    await page.getByTestId('font-list').evaluate((el) => (el.scrollTop = el.scrollHeight));
    const last = item(page, 'Fake Family 399');
    await expect(last).toBeVisible();
    // 假字体没有汉字数据（blob 为空，凭名字猜 → 无中文）
    await expect(last).toContainText('无中文');
    await last.click();
    await expect.poll(() => bodyStyle(page, 'font-family')).toContain('Fake Family 399');
    // 回到自定义页再进来：选中的项自动滚到视野里
    await page.getByTestId('font-back').click();
    await page.getByTestId('font-row').click();
    await expect(item(page, 'Fake Family 399')).toBeVisible();
    await expect(item(page, 'Fake Family 399')).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('本机字体（queryLocalFonts）', () => {
  test('授权后列出系统字体：中文本地化名正确，无汉字的标“无中文”，选中后正文生效', async ({ page, context }) => {
    await context.grantPermissions(['local-fonts']);
    await openReadingBook(page);
    await openFontPage(page);
    await expect(page.getByText('系统字体', { exact: true })).toBeVisible({ timeout: 30_000 });
    // 宋体、微软雅黑、楷体在“推荐”里，系统字体里不再重复；其他中文字体用简体中文名显示
    await expect(item(page, '黑体')).toBeVisible();
    await expect(item(page, '仿宋')).toBeVisible();
    await expect(page.getByTestId('font-item').filter({ hasText: /^宋体/ })).toHaveCount(1);
    // 搜英文名也找得到（显示名是中文）
    await page.getByTestId('font-search').fill('simhei');
    await expect(page.getByTestId('font-item')).toHaveCount(1);
    await expect(item(page, '黑体')).toHaveAttribute('data-font-id', 'sys:SimHei');
    await item(page, '黑体').click();
    await expect.poll(() => bodyStyle(page, 'font-family')).toContain('SimHei');
    // 没有汉字的字体标灰色小字，仍然可以选
    await page.getByTestId('font-search').fill('arial');
    await expect(item(page, 'Arial')).toContainText('无中文');
    await item(page, 'Arial').click();
    await expect.poll(() => bodyStyle(page, 'font-family')).toContain('Arial');
  });

  test('权限被拒绝：降级，只有推荐字体和导入的字体，不报错', async ({ page, context }) => {
    await context.addInitScript(() => {
      const perms = navigator.permissions;
      const orig = perms.query.bind(perms);
      perms.query = (d: PermissionDescriptor) =>
        (d as { name: string }).name === 'local-fonts' ? Promise.resolve({ state: 'denied' } as PermissionStatus) : orig(d);
      (window as unknown as { queryLocalFonts: () => Promise<never> }).queryLocalFonts = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    });
    await openReadingBook(page);
    await openFontPage(page);
    await importFixture(page);
    await expect(item(page, FAMILY)).toBeVisible();
    await expect(page.getByText('系统字体', { exact: true })).toHaveCount(0);
    await expect(page.getByText('推荐', { exact: true })).toBeVisible();
    // 选的是系统字体但系统字体列不出来时，不会误判成“不可用”
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const req = indexedDB.open('fjd');
          req.onsuccess = () => {
            const tx = req.result.transaction('kv', 'readwrite');
            tx.objectStore('kv').put({ appearance: { font: { id: 'sys:Some Font', family: 'Some Font' }, fontPinned: true } }, 'settings');
            tx.oncomplete = () => resolve();
          };
        }),
    );
    await page.reload();
    await waitReaderReady(page);
    await expect.poll(() => bodyStyle(page, 'font-family')).toContain('Some Font');
    await openFontPage(page);
    await expect(page.getByTestId('font-notice')).toHaveCount(0);
  });
});

test.describe('西文字体与字号', () => {
  test('西文字体默认“跟随中文字体”；可以单独指定，选回“跟随”恢复', async ({ page }) => {
    await openReadingBook(page);
    await openFontPage(page, 'west-row');
    // 西文页：最前面是“跟随中文字体”，没有“原始”
    await expect(page.getByTestId('font-item').first()).toContainText('跟随中文字体');
    await expect(page.getByTestId('font-item').first()).toHaveAttribute('aria-checked', 'true');
    await expect(item(page, '原始')).toHaveCount(0);
    expect(await stack(page)).toMatch(/^Georgia, SimSun/);

    await importFixture(page);
    await item(page, FAMILY).click();
    await expect.poll(() => stack(page)).toMatch(new RegExp(`^${FAMILY}, Georgia, SimSun`));
    await page.getByTestId('font-back').click();
    await expect(page.getByTestId('west-row')).toContainText(FAMILY);
    await expect(page.getByTestId('font-row')).toContainText('宋体');

    // 中文字体换成微软雅黑，西文字体保持
    await page.getByTestId('font-row').click();
    await item(page, '微软雅黑').click();
    await expect.poll(() => stack(page)).toMatch(new RegExp(`^${FAMILY}, Segoe UI, Microsoft YaHei`));

    // 选回“跟随”
    await page.getByTestId('font-back').click();
    await page.getByTestId('west-row').click();
    await page.getByTestId('font-item').first().click();
    await expect.poll(() => stack(page)).toMatch(/^Segoe UI, Microsoft YaHei/);
    await expect(page.getByTestId('west-row')).toHaveCount(0); // 在西文页里，没有这一行
    await page.getByTestId('font-back').click();
    await expect(page.getByTestId('west-row')).toContainText('跟随中文字体');
  });

  test('删掉被选作西文字体的字体：西文改回跟随，提示一次', async ({ page }) => {
    await openReadingBook(page);
    await openFontPage(page, 'west-row');
    await importFixture(page);
    await item(page, FAMILY).click();
    await expect.poll(() => bodyStyle(page, 'font-family')).toContain(FAMILY);
    await item(page, FAMILY).hover();
    await page.getByTestId('font-delete').click();
    await expect(page.getByTestId('font-notice')).toContainText(`字体 ${FAMILY} 不可用，西文已改为跟随中文字体`);
    await expect.poll(() => stack(page)).toMatch(/^Georgia, SimSun/);
  });

  test('字号滑块 12–48px 步长 1；小A/大A 仍按档位跳，不在档位上就从最接近的档位继续', async ({ page }) => {
    await openReadingBook(page, { long: true });
    await showToolbar(page);
    await page.getByTestId('appearance-button').click();
    await page.getByTestId('appearance-custom').click();
    const slider = page.getByRole('slider', { name: '字号' });
    await expect(slider).toHaveAttribute('min', '12');
    await expect(slider).toHaveAttribute('max', '48');
    await expect(slider).toHaveAttribute('step', '1');
    await expect(slider).toBeEnabled(); // 不受“自定义”开关管
    await expect(page.getByText('18px', { exact: true })).toBeVisible();

    const size = (): Promise<string> => bodyStyle(page, 'font-size');
    const before = await currentLocation(page);
    await slider.fill('25');
    await expect.poll(size).toBe('25px');
    await expect(page.getByText('25px', { exact: true })).toBeVisible();
    await slider.fill('12');
    await expect.poll(size).toBe('12px');
    await slider.fill('48');
    await expect.poll(size).toBe('48px');
    await slider.fill('25');
    await expect.poll(size).toBe('25px');
    const after = await currentLocation(page);
    expect(Math.abs(after!.fraction - before!.fraction)).toBeLessThan(0.03);

    // 回到主页：25px 最接近 24，大A → 27，小A → 22（从 27 再 → 24）
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('button', { name: '增大字号' }).click();
    await expect.poll(size).toBe('27px');
    await page.getByRole('button', { name: '减小字号' }).click();
    await expect.poll(size).toBe('24px');
    // 滑到 29（最接近 30），小A → 27
    await page.getByTestId('appearance-custom').click();
    await slider.fill('29');
    await expect.poll(size).toBe('29px');
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByRole('button', { name: '减小字号' }).click();
    await expect.poll(size).toBe('27px');
    // 快捷键同样
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+0');
    await expect.poll(size).toBe('18px');

    // 刷新后字号还在
    await showToolbar(page);
    await page.getByTestId('appearance-button').click();
    await page.getByTestId('appearance-custom').click();
    await slider.fill('33');
    await expect.poll(size).toBe('33px');
    await page.reload();
    await waitReaderReady(page);
    await expect.poll(size).toBe('33px');
  });

  test('旧版存档（font 是字符串、字号是档位）能读出来', async ({ page }) => {
    await openReadingBook(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const req = indexedDB.open('fjd');
          req.onsuccess = () => {
            const tx = req.result.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(
              { appearance: { theme: 'original', mode: 'light', fontStep: 5, font: 'kaiti', fontPinned: true } },
              'settings',
            );
            tx.oncomplete = () => resolve();
          };
        }),
    );
    await page.reload();
    await waitReaderReady(page);
    await expect.poll(() => bodyStyle(page, 'font-size')).toBe('22px');
    await expect.poll(() => bodyStyle(page, 'font-family')).toContain('KaiTi');
  });
});

test.describe('多窗口同步', () => {
  test('一个标签页改了字体、字号，另一个正在阅读的标签页立刻跟着变（BroadcastChannel）', async ({ page, context }) => {
    await openReadingBook(page);
    await waitReaderReady(page);
    const hash = new URL(page.url()).hash;
    // 同一个浏览器上下文里再开一个标签页，同一本书
    const other = await context.newPage();
    await other.goto(`/${hash}`);
    await waitReaderReady(other);
    expect(await bodyStyle(other, 'font-family')).toMatch(/SimSun/);
    expect(await bodyStyle(other, 'font-size')).toBe('18px');

    await page.bringToFront(); // 后台标签页的动画和定时器会被节流
    await openFontPage(page);
    await item(page, '楷体').click();
    await expect.poll(() => bodyStyle(page, 'font-family')).toContain('KaiTi');
    await expect.poll(() => bodyStyle(other, 'font-family')).toContain('KaiTi');

    await page.getByTestId('font-back').click();
    await page.getByRole('slider', { name: '字号' }).fill('30');
    await expect.poll(() => bodyStyle(other, 'font-size')).toBe('30px');

    // 导入的字体也同步过去：另一个标签页的 @font-face 更新，选用后能用上
    await page.getByTestId('font-row').click();
    await importFixture(page);
    await item(page, FAMILY).click();
    await expect.poll(() => bodyStyle(other, 'font-family')).toContain(FAMILY);
    await expect.poll(() => fontLoadedInReader(other, FAMILY)).toBe(true);
    await other.close();
  });
});
