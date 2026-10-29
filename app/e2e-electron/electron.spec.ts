// M3e 端到端：启动打包后的 繁体简读.exe（官方 Electron 原样二进制 + app.asar），用 Playwright 驱动界面。
//
// 覆盖：书库启动 → 命令行传入路径（模拟双击文件）冷启动导入并打开阅读窗口 → 简体正文 → 翻页 →
// 关闭阅读窗口（进度写盘）→ 重新打开仍在原位置 → 单实例转发第二本书 → fjd:// 路径穿越被拒绝 →
// 窗口位置和大小被记住 → 关闭书库退出整个程序。
// 数据目录由 FJD_USER_DATA 指向临时目录；带 --no-register，不写开始菜单和注册表。
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { currentLocation, currentSectionText, gotoSection, ROOT, searchableTexts, squash, waitReaderReady } from '../e2e/helpers';
import { buildReadingBook } from '../e2e/reading-book';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXE = process.env.FJD_EXE ?? path.resolve(here, '../release/繁体简读/繁体简读.exe');
// 样书是现场合成的（reading-book.ts），测试开始时写到临时目录
const SAMPLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fjd-electron-sample-'));
const SAMPLE = path.join(SAMPLE_DIR, 'reading.epub');
const PHRASE = '认真地把每一个字都写得端端正正';
const SECOND = path.join(ROOT, 'fixtures', 'books', 'tw-sample.fb2');
const SHOTS = path.resolve(here, '../../screenshots/M3e');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'fjd-electron-e2e-'));
const ENV = { ...process.env, FJD_USER_DATA: DATA, FJD_NO_REGISTER: '1' } as Record<string, string>;

let app: ElectronApplication | null = null;

const isLibrary = (p: Page): boolean => !p.url().includes('#/reader/') && p.url().startsWith('fjd://app/');
const isReader = (p: Page): boolean => p.url().includes('#/reader/');

async function launch(args: string[] = []): Promise<ElectronApplication> {
  app = await electron.launch({ executablePath: EXE, args: ['--no-register', ...args], env: ENV });
  return app;
}

async function waitPage(match: (p: Page) => boolean, timeout = 60_000): Promise<Page> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const p = app!.windows().find((w) => !w.isClosed() && match(w));
    if (p) return p;
    if (Date.now() > deadline) throw new Error(`等不到窗口；现有：${app!.windows().map((w) => w.url()).join(' | ')}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const readerPages = (): Page[] => app!.windows().filter((w) => !w.isClosed() && isReader(w));

/** 退出：关掉书库窗口（走正常的“关闭书库就是退出”流程），等进程结束 */
async function quitViaLibrary(): Promise<void> {
  if (!app) return;
  const a = app;
  const proc = a.process();
  const lib = a.windows().find((w) => !w.isClosed() && isLibrary(w));
  if (lib) await lib.getByRole('button', { name: '关闭' }).click();
  await expect.poll(() => proc.exitCode !== null || proc.signalCode !== null, { timeout: 30_000 }).toBe(true);
  app = null;
}

async function forceQuit(): Promise<void> {
  if (!app) return;
  await app.close().catch(() => {});
  app = null;
}

const readLibraryJson = (): { books: { id: string; progress?: { fraction: number }; title: string }[] } =>
  JSON.parse(fs.readFileSync(path.join(DATA, 'library.json'), 'utf8'));

test.describe.serial('Electron 外壳：启动、导入、阅读、续读、单实例、协议安全', () => {
  test.skip(!fs.existsSync(EXE), `没有 ${EXE}，先运行 pnpm --filter app pack:win`);

  test.beforeAll(() => {
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(SAMPLE, buildReadingBook(14));
  });
  test.afterAll(async () => {
    await forceQuit();
    fs.rmSync(DATA, { recursive: true, force: true });
    fs.rmSync(SAMPLE_DIR, { recursive: true, force: true });
  });

  test('1. 启动后显示书库；渲染进程是隔离的沙箱', async () => {
    await launch();
    const lib = await waitPage(isLibrary);
    await expect(lib.getByTestId('empty-library')).toBeVisible();
    await lib.waitForTimeout(800);
    await lib.screenshot({ path: path.join(SHOTS, '01-library-empty.png') });

    // 渲染进程里没有 Node
    const globals = await lib.evaluate(() => ({
      process: typeof (window as unknown as { process?: unknown }).process,
      require: typeof (window as unknown as { require?: unknown }).require,
      bridge: typeof window.fjdElectron,
    }));
    expect(globals).toEqual({ process: 'undefined', require: 'undefined', bridge: 'object' });
    // 窗口的安全设置
    const prefs = await app!.evaluate(({ BrowserWindow }) => {
      // getLastWebPreferences 是 Electron 的内部接口，类型声明里没有
      const wc = BrowserWindow.getAllWindows()[0]!.webContents as unknown as {
        getLastWebPreferences(): { contextIsolation: boolean; nodeIntegration: boolean; sandbox: boolean };
      };
      const p = wc.getLastWebPreferences();
      return { contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, sandbox: p.sandbox };
    });
    expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
    // 无边框；设计尺寸 1144×860
    const frame = await app!.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      return { size: w.getSize(), isFrameless: w.getBounds().width === w.getContentBounds().width };
    });
    expect(frame.isFrameless).toBe(true);
    expect(frame.size[0]).toBeGreaterThanOrEqual(1100);
    // 拖动区：标题栏是 drag，窗口按钮是 no-drag（-webkit-app-region 由 platform/electron.ts 注入的样式给出）
    const regions = await lib.evaluate(() => {
      const r = (sel: string): string => getComputedStyle(document.querySelector(sel)!).getPropertyValue('-webkit-app-region');
      return { titlebar: r('.titlebar'), sidebarTop: r('.sidebar-top'), controls: r('.window-controls'), close: r('.wc-btn.close') };
    });
    expect(regions).toEqual({ titlebar: 'drag', sidebarTop: 'drag', controls: 'no-drag', close: 'no-drag' });
    // 数据目录结构
    for (const d of ['books', 'covers', 'annotations']) expect(fs.existsSync(path.join(DATA, d))).toBe(true);
  });

  test('2. 命令行传入路径（模拟双击文件）：导入并在阅读窗口显示简体', async () => {
    await quitViaLibrary();
    await launch([SAMPLE]);
    const lib = await waitPage(isLibrary);
    await expect(lib.getByTestId('book-card')).toHaveCount(1, { timeout: 60_000 });
    await lib.screenshot({ path: path.join(SHOTS, '02-library-imported.png') });
    const reader = await waitPage(isReader);
    await waitReaderReady(reader);
    const texts = (await searchableTexts(reader)).map(squash);
    const idx = texts.findIndex((t) => t.includes(PHRASE));
    expect(idx).toBeGreaterThanOrEqual(0);
    await gotoSection(reader, idx);
    expect(squash(await currentSectionText(reader))).toContain(PHRASE);
    await reader.waitForTimeout(1000);
    await reader.screenshot({ path: path.join(SHOTS, '03-reader-open.png') });

    // 数据落盘：library.json 里有这本书，books/ 下有文件，没有残留的 .tmp / .part
    const lib1 = readLibraryJson();
    expect(lib1.books).toHaveLength(1);
    const id = lib1.books[0]!.id;
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(fs.existsSync(path.join(DATA, 'books', `${id}.epub`))).toBe(true);
    expect(fs.existsSync(path.join(DATA, 'covers', `${id}.jpg`))).toBe(true);
    const leftovers = [...fs.readdirSync(DATA), ...fs.readdirSync(path.join(DATA, 'books'))].filter((n) => /\.(tmp|part)$/.test(n));
    expect(leftovers).toEqual([]);
  });

  let savedFraction = 0;

  test('3. 翻页后关闭阅读窗口，进度已写盘；书库窗口还在', async () => {
    const reader = await waitPage(isReader);
    for (let i = 0; i < 4; i++) {
      await reader.keyboard.press('PageDown');
      await reader.waitForTimeout(500);
    }
    const loc = await currentLocation(reader);
    expect(loc?.fraction ?? 0).toBeGreaterThan(0);
    savedFraction = loc!.fraction;
    // 鼠标移到顶部让工具栏出来，再点窗口按钮“关闭”
    await reader.mouse.move(600, 10);
    await expect(reader.getByTestId('toolbar')).toHaveClass(/visible/);
    await reader.screenshot({ path: path.join(SHOTS, '04-reader-toolbar.png') });
    await reader.getByRole('button', { name: '关闭' }).click();
    await expect.poll(() => readerPages().length, { timeout: 15_000 }).toBe(0);
    expect(app!.windows().some((w) => !w.isClosed() && isLibrary(w))).toBe(true);
    expect(readLibraryJson().books[0]!.progress?.fraction).toBeCloseTo(savedFraction, 2);
  });

  test('4. 书库里再点开这本书，位置还在', async () => {
    const lib = await waitPage(isLibrary);
    await lib.getByTestId('book-card').getByRole('button').first().click();
    const reader = await waitPage(isReader);
    await waitReaderReady(reader);
    await reader.waitForTimeout(1000);
    expect((await currentLocation(reader))?.fraction).toBeCloseTo(savedFraction, 1);
    await reader.screenshot({ path: path.join(SHOTS, '05-reader-reopened.png') });
  });

  test('5. 全部退出后重开，阅读位置还在', async () => {
    await quitViaLibrary();
    await launch();
    const lib = await waitPage(isLibrary);
    await expect(lib.getByTestId('book-card')).toHaveCount(1);
    await lib.getByTestId('book-card').getByRole('button').first().click();
    const reader = await waitPage(isReader);
    await waitReaderReady(reader);
    await reader.waitForTimeout(1000);
    expect((await currentLocation(reader))?.fraction).toBeCloseTo(savedFraction, 1);
  });

  test('6. 再次打开同一本书只聚焦已有窗口；第二个实例把第二本书转交给已运行的实例', async () => {
    const lib = await waitPage(isLibrary);
    await lib.getByTestId('book-card').getByRole('button').first().click();
    await lib.waitForTimeout(800);
    expect(readerPages()).toHaveLength(1);

    // 第二个进程：参数转发给已运行的实例，自己退出
    const second: ChildProcess = spawn(EXE, ['--no-register', SECOND], { env: ENV, stdio: 'ignore' });
    await expect.poll(() => second.exitCode !== null, { timeout: 30_000 }).toBe(true);
    await expect(lib.getByTestId('book-card')).toHaveCount(2, { timeout: 60_000 });
    await expect.poll(() => readerPages().length, { timeout: 30_000 }).toBe(2);
    await lib.screenshot({ path: path.join(SHOTS, '06-library-two-books.png') });

    // txt：导入时拼成 epub 存为 <id>.epub，不留 .txt 副本
    const third: ChildProcess = spawn(EXE, ['--no-register', path.join(ROOT, 'fixtures', 'txt', 'chapters-hant.txt')], {
      env: ENV,
      stdio: 'ignore',
    });
    await expect.poll(() => third.exitCode !== null, { timeout: 30_000 }).toBe(true);
    await expect(lib.getByTestId('book-card')).toHaveCount(3, { timeout: 60_000 });
    const names = fs.readdirSync(path.join(DATA, 'books'));
    expect(names.filter((n) => n.endsWith('.txt'))).toEqual([]);
  });

  test('7. fjd:// 路径穿越被拒绝，数据目录之外和 JSON 都读不到', async () => {
    const lib = await waitPage(isLibrary);
    const { books } = readLibraryJson();
    const id = books[0]!.id;
    const probe = (url: string): Promise<{ status: number; type: string; len: number }> =>
      lib.evaluate(async (u) => {
        try {
          const r = await fetch(u);
          return { status: r.status, type: r.headers.get('content-type') ?? '', len: (await r.arrayBuffer()).byteLength };
        } catch {
          return { status: 0, type: '', len: 0 };
        }
      }, url);

    // 对照：正常的书和封面可以读
    expect((await probe(`fjd://data/books/${id}.epub`)).status).toBe(200);
    expect((await probe(`fjd://data/covers/${id}.jpg`)).status).toBe(200);

    const bad = [
      'fjd://data/library.json',
      'fjd://data/settings.json',
      'fjd://data/annotations/x.json',
      'fjd://data/books/../library.json',
      'fjd://data/books/%2e%2e/library.json',
      'fjd://data/books/..%2flibrary.json',
      'fjd://data/books/..%5clibrary.json',
      'fjd://data/books/%2e%2e%2f%2e%2e%2fwindow-state.json',
      'fjd://data/books/..%252flibrary.json',
      'fjd://data/books/C:%5CWindows%5Cwin.ini',
      'fjd://data/books/C:/Windows/win.ini',
      'fjd://data/..%2f..%2f..%2fWindows%2Fwin.ini',
      'fjd://data/books/a/b.epub',
      'fjd://data/books/',
      'fjd://data/',
      'fjd://data/shell.json',
      'fjd://data/window-state.json',
      'fjd://app/../library.json',
      'fjd://app/%2e%2e/library.json',
      'fjd://app/..%2f..%2fmain.cjs',
      'fjd://app/..%5c..%5cmain.cjs',
      'fjd://other/index.html',
    ];
    for (const u of bad) {
      const r = await probe(u);
      expect(r.status, u).not.toBe(200);
    }
    // 即使状态码不是 200，也不能带回 library.json 的内容
    const leak = await lib.evaluate(async () => {
      const r = await fetch('fjd://data/books/%2e%2e/library.json').catch(() => null);
      return r ? await r.text() : '';
    });
    expect(leak).not.toContain('"books"');

    // IPC 一侧同样拒绝越界的相对路径
    const ipc = await lib.evaluate(async () => {
      const api = window.fjdElectron!;
      const tries = ['../x.json', 'books/../library.json', '/etc/passwd', 'C:\\Windows\\win.ini', 'books/..\\x', 'shell.json', 'window-state.json'];
      const out: Record<string, string> = {};
      for (const t of tries) {
        try {
          await api.readJson(t);
          out[t] = 'ok';
        } catch (e) {
          out[t] = 'rejected';
        }
      }
      return out;
    });
    for (const [k, v] of Object.entries(ipc)) expect(v, k).toBe('rejected');
  });

  test('8. 记住窗口位置和大小', async () => {
    await app!.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('#/reader/'))!;
      main.setBounds({ x: 137, y: 91, width: 1010, height: 700 });
    });
    await new Promise((r) => setTimeout(r, 900)); // 保存有 500ms 的防抖
    await quitViaLibrary();
    expect(fs.existsSync(path.join(DATA, 'window-state.json'))).toBe(true);

    // 高分屏的缩放比例（本机 250%）会让 DIP 尺寸有几个像素的舍入误差，所以允许 ±3，并且来回重启两次不能越变越大
    const near = (a: number, b: number): void => expect(Math.abs(a - b)).toBeLessThanOrEqual(3);
    const mainBounds = (): Promise<Electron.Rectangle> =>
      app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('#/reader/'))!.getBounds());
    for (let round = 0; round < 2; round++) {
      await launch();
      const lib = await waitPage(isLibrary);
      await expect(lib.getByTestId('book-card')).toHaveCount(3);
      const b = await mainBounds();
      near(b.x, 137);
      near(b.y, 91);
      near(b.width, 1010);
      near(b.height, 700);
      if (round === 0) await quitViaLibrary();
    }
  });

  test('9. 打开阅读窗口后关闭书库：阅读窗口随之关闭，进程结束', async () => {
    const lib = await waitPage(isLibrary);
    await lib.getByTestId('book-card').getByRole('button').first().click();
    await waitPage(isReader);
    await quitViaLibrary();
    expect(app).toBeNull();
  });
});

// 回归：Windows 版点“添加图书”、选好文件后没有反应。
// 原因：桌面版文件选择框返回的是路径，书库只收 File，路径被过滤掉了。这里用真实按钮回归。
test.describe.serial('Electron 外壳：书库里“添加图书”按钮', () => {
  test.skip(!fs.existsSync(EXE), `没有 ${EXE}，先运行 pnpm --filter app pack:win`);
  const DATA2 = fs.mkdtempSync(path.join(os.tmpdir(), 'fjd-electron-add-'));
  const BOOK = path.join(ROOT, 'fixtures', 'books', 'tw-big5.txt');
  let app2: ElectronApplication | null = null;

  test.afterAll(async () => {
    await app2?.close().catch(() => {});
    fs.rmSync(DATA2, { recursive: true, force: true });
  });

  test('空书库点“添加图书”，再从“更多”菜单添加第二本：两本都进书库', async () => {
    app2 = await electron.launch({ executablePath: EXE, args: ['--no-register'], env: { ...ENV, FJD_USER_DATA: DATA2 } });
    const lib = await app2.firstWindow();
    await expect(lib.getByTestId('empty-library')).toBeVisible({ timeout: 60_000 });
    await app2.evaluate(({ dialog }, file) => {
      (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, BOOK);
    await lib.getByTestId('empty-library').getByRole('button', { name: '添加图书' }).click();
    await expect(lib.getByTestId('book-card')).toHaveCount(1, { timeout: 60_000 });

    await app2.evaluate(({ dialog }, file) => {
      (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, SECOND);
    await lib.getByRole('button', { name: '更多' }).first().click();
    await lib.getByRole('menuitem', { name: /添加图书/ }).click();
    await expect(lib.getByTestId('book-card')).toHaveCount(2, { timeout: 60_000 });
    // 书文件确实复制进了数据目录
    expect(fs.readdirSync(path.join(DATA2, 'books')).length).toBe(2);
  });
});
