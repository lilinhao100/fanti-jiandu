// M2d 端到端（Electron）：启动打包后的 繁体简读.exe，验证字体功能：
// 主进程扫描系统字体（> 20 个，微软雅黑 / 宋体的中文名正确）、字体页选系统字体正文生效、西文字体、
// 导入字体（文件选择框用 mock）经 fjd://data/fonts 加载进阅读 iframe、删除后退回宋体、
// 存档里的字体已被卸载时启动退回宋体并提示、书库窗口同步设置。
// 数据目录由 FJD_USER_DATA 指向临时目录；带 --no-register。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { ROOT, waitReaderReady } from '../e2e/helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXE = process.env.FJD_EXE ?? path.resolve(here, '../release/繁体简读/繁体简读.exe');
const BOOK = path.join(ROOT, 'fixtures', 'books', 'tw-sample.fb2');
const FIXTURE_FONT = path.join(ROOT, 'fixtures', 'fonts', 'NotoSerifSC-subset.ttf');
const SHOTS = path.resolve(here, '../../screenshots/M2d');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fjd-electron-fonts-'));
const ENV = { ...process.env, FJD_USER_DATA: DATA, FJD_NO_REGISTER: '1' } as Record<string, string>;
const FAMILY = 'Noto Serif SC';

let app: ElectronApplication | null = null;

const isLibrary = (p: Page): boolean => !p.url().includes('#/reader/') && p.url().startsWith('fjd://app/');
const isReader = (p: Page): boolean => p.url().includes('#/reader/');

async function waitPage(match: (p: Page) => boolean, timeout = 60_000): Promise<Page> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const p = app!.windows().find((w) => !w.isClosed() && match(w));
    if (p) return p;
    if (Date.now() > deadline) throw new Error(`等不到窗口；现有：${app!.windows().map((w) => w.url()).join(' | ')}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function launch(args: string[] = []): Promise<ElectronApplication> {
  app = await electron.launch({ executablePath: EXE, args: ['--no-register', ...args], env: ENV });
  return app;
}

async function quit(): Promise<void> {
  if (!app) return;
  const a = app;
  const proc = a.process();
  const lib = a.windows().find((w) => !w.isClosed() && isLibrary(w));
  if (lib) await lib.getByRole('button', { name: '关闭' }).click();
  await expect.poll(() => proc.exitCode !== null || proc.signalCode !== null, { timeout: 30_000 }).toBe(true);
  app = null;
}

const settingsOnDisk = (): { appearance: { font: { id: string; family: string }; fontWest?: unknown; fontSize?: number } } =>
  JSON.parse(fs.readFileSync(path.join(DATA, 'settings.json'), 'utf8'));

function bodyStyle(page: Page, prop: string): Promise<string> {
  return page.evaluate((p) => {
    const doc = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc;
    return getComputedStyle(doc.body).getPropertyValue(p);
  }, prop);
}

/** 这台电脑上有没有这个字体（在阅读 iframe 里量宽度：有的话和找不到字体时的备用字体宽度不同） */
function fontInstalled(page: Page, family: string): Promise<boolean> {
  return page.evaluate((fam) => {
    const doc = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc;
    const w = (f: string): number => {
      const s = doc.createElement('span');
      s.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:40px ${f}`;
      s.textContent = 'WiWiWiWi mmmm 0123456789 繁体简读';
      doc.body.append(s);
      const width = s.getBoundingClientRect().width;
      s.remove();
      return width;
    };
    return w(`"${fam}"`) !== w('"NoSuchFontXyz123"');
  }, family);
}

async function showToolbar(page: Page): Promise<void> {
  const w = (await page.viewportSize())?.width ?? 1000;
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

const item = (page: Page, name: string | RegExp) => page.getByTestId('font-item').filter({ hasText: name });
/** 导入的那一项（这台电脑上可能也装了同名的系统字体，所以按 id 找） */
const imported = (page: Page) => page.locator(`[data-font-id="imp:${FAMILY}"]`);

test.describe.serial('Electron 字体：系统字体扫描、导入、退回宋体、多窗口同步', () => {
  test.skip(!fs.existsSync(EXE), `没有 ${EXE}，先运行 pnpm --filter app pack:win`);

  test.beforeAll(() => {
    fs.mkdirSync(SHOTS, { recursive: true });
    // 存档里的字体是一个这台电脑上没有的系统字体：模拟“字体被卸载”
    fs.writeFileSync(
      path.join(DATA, 'settings.json'),
      JSON.stringify({ appearance: { mode: 'light', font: { id: 'sys:No Such Font', family: 'No Such Font' }, fontPinned: true } }),
    );
  });
  test.afterAll(async () => {
    await app?.close().catch(() => {});
    fs.rmSync(DATA, { recursive: true, force: true });
  });

  test('1. 存档里的系统字体已被卸载：打开阅读器退回宋体，面板里提示一次，存档也改了', async () => {
    await launch([BOOK]);
    const reader = await waitPage(isReader);
    await waitReaderReady(reader);
    await expect.poll(() => bodyStyle(reader, 'font-family')).toContain('SimSun');
    await showToolbar(reader);
    await reader.getByTestId('appearance-button').click();
    await reader.getByTestId('appearance-custom').click();
    await expect(reader.getByTestId('font-notice')).toHaveText(/字体 No Such Font 不可用，已改用宋体/);
    await expect.poll(() => settingsOnDisk().appearance.font.id).toBe('songti');
    // 关掉面板再打开，提示不再出现（只提示一次）
    await reader.keyboard.press('Escape');
    await showToolbar(reader);
    await reader.getByTestId('appearance-button').click();
    await reader.getByTestId('appearance-custom').click();
    await expect(reader.getByTestId('font-notice')).toHaveCount(0);
  });

  test('2. 主进程列出系统字体：超过 20 个，微软雅黑、宋体的中文名正确，缓存写进数据目录', async () => {
    const lib = await waitPage(isLibrary);
    const t0 = Date.now();
    const fonts = await lib.evaluate(() => window.fjdElectron!.fonts.list());
    const ms = Date.now() - t0;
    expect(fonts.length).toBeGreaterThan(20);
    const by = (family: string) => fonts.find((f) => f.family === family);
    expect(by('Microsoft YaHei')).toMatchObject({ displayName: '微软雅黑', source: 'system', hasCJK: true, id: 'sys:Microsoft YaHei' });
    expect(by('SimSun')).toMatchObject({ displayName: '宋体', hasCJK: true });
    expect(by('Arial')).toMatchObject({ hasCJK: false });
    expect(new Set(fonts.map((f) => f.family.toLowerCase())).size).toBe(fonts.length);
    console.log(`系统字体 ${fonts.length} 个，主进程 ${ms}ms`);
    expect(fs.existsSync(path.join(DATA, 'font-cache.json'))).toBe(true);
    const cache = JSON.parse(fs.readFileSync(path.join(DATA, 'font-cache.json'), 'utf8')) as { version: number; stamps: object; fonts: unknown[] };
    expect(cache.fonts).toHaveLength(fonts.length);
    expect(Object.keys(cache.stamps).length).toBeGreaterThan(0);
  });

  test('3. 字体页：三组、搜索“楷”、选一个系统字体正文立即生效', async () => {
    const reader = await waitPage(isReader);
    await reader.keyboard.press('Escape');
    await openFontPage(reader);
    await expect(reader.getByText('系统字体', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(reader.getByText('推荐', { exact: true })).toBeVisible();
    await reader.waitForTimeout(500);
    await reader.screenshot({ path: path.join(SHOTS, 'electron-font-page.png') });

    // 虚拟滚动：DOM 里的行远少于字体总数
    const total = await reader.evaluate(() => window.fjdElectron!.fonts.list().then((l) => l.length));
    expect(await reader.getByTestId('font-item').count()).toBeLessThan(Math.min(total, 40));

    const search = reader.getByTestId('font-search');
    await search.fill('楷');
    await expect(item(reader, '楷体')).toBeVisible();
    await expect(reader.getByText('我导入的')).toHaveCount(0);
    await reader.screenshot({ path: path.join(SHOTS, 'electron-search-kai.png') });

    await search.fill('黑体');
    await expect(reader.getByTestId('font-item')).toHaveCount(1);
    const before = await reader.evaluate(() => window.__fjd!.controller.debug.view!.lastLocation?.fraction ?? 0);
    await item(reader, '黑体').click();
    await expect(item(reader, '黑体')).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => bodyStyle(reader, 'font-family')).toContain('SimHei');
    expect(await fontInstalled(reader, 'SimHei')).toBe(true);
    const after = await reader.evaluate(() => window.__fjd!.controller.debug.view!.lastLocation?.fraction ?? 0);
    expect(Math.abs(after - before)).toBeLessThan(0.02);
    await expect.poll(() => settingsOnDisk().appearance.font).toEqual({ id: 'sys:SimHei', family: 'SimHei' });

    // 无汉字的字体：灰色小字“无中文”，仍然可以选
    await search.fill('arial');
    await expect(item(reader, 'Arial')).toContainText('无中文');
  });

  test('4. 书库窗口同步到阅读窗口里改的设置（平台层广播“设置已变”）', async () => {
    const lib = await waitPage(isLibrary);
    await lib.keyboard.press('Control+,');
    await lib.getByRole('button', { name: '阅读' }).click();
    // 默认字体里最前面多出一行当前字体（黑体），并且是选中的
    await expect(lib.getByRole('radio', { name: /黑体/ })).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
    await lib.keyboard.press('Escape');
  });

  test('5. 西文字体：单独指定后放在栈的最前面，且确实生效', async () => {
    const reader = await waitPage(isReader);
    await reader.getByTestId('font-back').click();
    await reader.getByTestId('west-row').click();
    await expect(reader.getByTestId('font-item').first()).toContainText('跟随中文字体');
    await reader.getByTestId('font-search').fill('consolas');
    await item(reader, 'Consolas').click();
    await expect.poll(() => bodyStyle(reader, 'font-family')).toMatch(/^Consolas, SimHei/);
    expect(await fontInstalled(reader, 'Consolas')).toBe(true);
    await reader.getByTestId('font-search').fill('');
    await reader.getByTestId('font-item').first().click(); // 选回“跟随”
    await expect.poll(() => bodyStyle(reader, 'font-family')).toMatch(/^SimHei/);
  });

  test('6. 导入字体（文件选择框 mock）：经 fjd://data/fonts 加载进阅读 iframe；刷新窗口仍在', async () => {
    const reader = await waitPage(isReader);
    await app!.evaluate(({ dialog }, file) => {
      (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, FIXTURE_FONT);
    await reader.getByTestId('font-back').click();
    await reader.getByTestId('font-row').click();
    await reader.getByTestId('font-import').click();
    await expect(reader.getByText('我导入的', { exact: true })).toBeVisible();
    const row = imported(reader);
    await expect(row).toBeVisible();
    await row.click();
    await expect.poll(() => bodyStyle(reader, 'font-family')).toContain(FAMILY);
    // 字体文件在 iframe 里真的加载成功了（跨源、CSP 都通过）
    await expect
      .poll(() =>
        reader.evaluate(async (fam) => {
          const doc = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc;
          await doc.fonts.ready;
          return [...doc.fonts].some((f) => f.family.replace(/"/g, '') === fam && f.status === 'loaded');
        }, FAMILY),
      )
      .toBe(true);
    // 数据目录：fonts/ 下的文件 + fonts.json 登记
    const files = fs.readdirSync(path.join(DATA, 'fonts'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{12}\.ttf$/);
    const reg = JSON.parse(fs.readFileSync(path.join(DATA, 'fonts.json'), 'utf8')) as { fonts: { id: string; family: string }[] };
    expect(reg.fonts).toMatchObject([{ id: `imp:${FAMILY}`, family: FAMILY }]);
    await reader.waitForTimeout(500);
    await reader.screenshot({ path: path.join(SHOTS, 'electron-imported.png') });

    // fjd://data/fonts 只提供字体文件：登记表和缓存读不到
    const probe = (url: string): Promise<number> =>
      reader.evaluate(async (u) => {
        try {
          return (await fetch(u)).status;
        } catch {
          return 0;
        }
      }, url);
    expect(await probe(`fjd://data/fonts/${files[0]}`)).toBe(200);
    expect(await probe('fjd://data/fonts.json')).toBe(403);
    expect(await probe('fjd://data/font-cache.json')).toBe(403);
    expect(await probe('fjd://data/fonts/..%2Ffonts.json')).toBe(403);

    // 窗口刷新后仍然生效
    await reader.reload();
    await waitReaderReady(reader);
    await expect.poll(() => bodyStyle(reader, 'font-family')).toContain(FAMILY);
    await expect
      .poll(() =>
        reader.evaluate(async (fam) => {
          const doc = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.doc;
          await doc.fonts.ready;
          return doc.fonts.check(`18px "${fam}"`, '繁体简读');
        }, FAMILY),
      )
      .toBe(true);
  });

  test('7. 书库窗口也收到“字体变了”：列表里有导入的字体', async () => {
    const lib = await waitPage(isLibrary);
    await expect
      .poll(() => lib.evaluate(() => window.fjdElectron!.fonts.list().then((l) => l.filter((f) => f.source === 'imported').map((f) => f.family))))
      .toEqual([FAMILY]);
    // 书库窗口的界面里 @font-face 也注入了（字体页预览要用）
    await expect.poll(() => lib.evaluate(() => document.getElementById('fjd-font-faces')?.textContent ?? '')).toContain(FAMILY);
  });

  test('8. 删除导入的字体：正文退回宋体，面板提示，文件和登记都删掉', async () => {
    const reader = await waitPage(isReader);
    await openFontPage(reader);
    const row = imported(reader);
    await expect(row).toHaveAttribute('aria-checked', 'true');
    await row.hover();
    await reader.getByTestId('font-delete').click();
    await expect(reader.getByTestId('font-notice')).toHaveText(`字体 ${FAMILY} 不可用，已改用宋体`);
    await expect.poll(() => bodyStyle(reader, 'font-family')).toContain('SimSun');
    await expect(reader.locator('[data-font-id="songti"]')).toHaveAttribute('aria-checked', 'true');
    expect(fs.readdirSync(path.join(DATA, 'fonts'))).toEqual([]);
    expect((JSON.parse(fs.readFileSync(path.join(DATA, 'fonts.json'), 'utf8')) as { fonts: unknown[] }).fonts).toEqual([]);
    await expect.poll(() => settingsOnDisk().appearance.font.id).toBe('songti');
    await expect(reader.getByText('我导入的')).toHaveCount(0);
  });

  test('9. 重启后第二次扫描走缓存；字号滑块细调后存档里是 px', async () => {
    const reader = await waitPage(isReader);
    await reader.keyboard.press('Escape');
    await showToolbar(reader);
    await reader.getByTestId('appearance-button').click();
    await reader.getByTestId('appearance-custom').click();
    await reader.getByRole('slider', { name: '字号' }).fill('29');
    await expect.poll(() => bodyStyle(reader, 'font-size')).toBe('29px');
    await expect.poll(() => settingsOnDisk().appearance.fontSize).toBe(29);
    const stampBefore = fs.statSync(path.join(DATA, 'font-cache.json')).mtimeMs;
    await quit();
    await launch([BOOK]);
    const r2 = await waitPage(isReader);
    await waitReaderReady(r2);
    await expect.poll(() => bodyStyle(r2, 'font-size')).toBe('29px');
    const n = await r2.evaluate(() => window.fjdElectron!.fonts.list().then((l) => l.length));
    expect(n).toBeGreaterThan(20);
    // 字体目录没变：缓存文件没有被重写
    expect(fs.statSync(path.join(DATA, 'font-cache.json')).mtimeMs).toBe(stampBefore);
    await quit();
  });
});
