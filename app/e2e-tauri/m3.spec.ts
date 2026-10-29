// M3 端到端：拉起打包好的 exe，通过 WebView2 的远程调试端口（CDP）用 Playwright 驱动界面。
// （tauri-driver 需要匹配 WebView2 版本的 msedgedriver，本机下载不稳，CDP 方案不依赖它。）
//
// 覆盖：书库窗口启动 → 命令行传入路径（模拟双击文件）冷启动导入并打开阅读窗口 → 翻页 →
// 关闭阅读窗口（进度写盘）→ 重新打开仍在原位置 → 单实例转发第二本书 → 关闭书库退出整个应用。
// 注意：会清空 %APPDATA%\com.fantijiandu.reader，不要在存有真实书库的机器上跑。
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { currentLocation, ROOT, waitReaderReady } from '../e2e/helpers';
import { buildReadingBook } from '../e2e/reading-book';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXE = process.env.FJD_EXE ?? path.resolve(here, '../src-tauri/target/release/fantijiandu.exe');
// 样书是现场合成的（reading-book.ts），测试开始时写到临时目录
const SAMPLE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fjd-tauri-sample-'));
const SAMPLE = path.join(SAMPLE_DIR, 'reading.epub');
const SECOND = path.join(ROOT, 'fixtures', 'books', 'tw-sample.fb2');
const PORT = Number(process.env.FJD_CDP_PORT ?? 9333);
const DATA = path.join(process.env.APPDATA ?? os.homedir(), 'com.fantijiandu.reader');
const SHOTS = path.resolve(here, '../../screenshots/M3');

let proc: ChildProcess | null = null;
let browser: Browser | null = null;

function launch(args: string[]): ChildProcess {
  const p = spawn(EXE, args, {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: 'ignore',
  });
  return p;
}

async function connect(): Promise<Browser> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    } catch (e) {
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const pages = (): Page[] => browser!.contexts().flatMap((c) => c.pages());

async function waitPage(match: (url: string) => boolean, timeout = 60_000): Promise<Page> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const p = pages().find((x) => match(x.url()));
    if (p) return p;
    if (Date.now() > deadline) throw new Error(`等不到窗口；现有：${pages().map((x) => x.url()).join(' | ')}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const isLibrary = (u: string): boolean => /\/(index\.html)?(#\/library)?$/.test(u) || u.includes('#/library');
const isReader = (u: string): boolean => u.includes('#/reader/');

async function quit(): Promise<void> {
  await browser?.close().catch(() => {});
  browser = null;
  if (proc && proc.exitCode === null) {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  proc = null;
}

test.describe.serial('Tauri 外壳：启动、导入、阅读、续读', () => {
  test.skip(!fs.existsSync(EXE), `没有 ${EXE}，先运行 pnpm --filter app tauri build`);

  test.beforeAll(() => {
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(SAMPLE, buildReadingBook(14));
    fs.rmSync(DATA, { recursive: true, force: true });
  });
  test.afterAll(async () => {
    await quit();
    fs.rmSync(SAMPLE_DIR, { recursive: true, force: true });
  });

  test('1. 启动后显示书库', async () => {
    proc = launch([]);
    browser = await connect();
    const lib = await waitPage(isLibrary);
    await expect(lib.getByTestId('empty-library')).toBeVisible();
    await lib.waitForTimeout(800);
    await lib.screenshot({ path: path.join(SHOTS, '01-library-empty.png') });
    // 无系统边框，窗口大小是 1144×860 的设计值
    const size = await lib.evaluate(() => [window.innerWidth, window.innerHeight]);
    expect(size[0]).toBeGreaterThanOrEqual(1100);
    expect(size[1]).toBeGreaterThanOrEqual(800);
  });

  test('2. 命令行传入路径（模拟双击文件）：导入并打开阅读窗口', async () => {
    await quit();
    proc = launch([SAMPLE]);
    browser = await connect();
    const lib = await waitPage(isLibrary);
    await expect(lib.getByTestId('book-card')).toHaveCount(1, { timeout: 60_000 });
    await lib.screenshot({ path: path.join(SHOTS, '02-library-imported.png') });
    const reader = await waitPage(isReader);
    await waitReaderReady(reader);
    await reader.waitForTimeout(1200);
    await reader.screenshot({ path: path.join(SHOTS, '03-reader-open.png') });
    // 数据落盘：library.json 里有这本书，books/ 下有文件，没有残留的 .tmp / .part
    const lib1 = JSON.parse(fs.readFileSync(path.join(DATA, 'library.json'), 'utf8')) as { books: { id: string }[] };
    expect(lib1.books).toHaveLength(1);
    const id = lib1.books[0]!.id;
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(fs.existsSync(path.join(DATA, 'books', `${id}.epub`))).toBe(true);
    const leftovers = [...fs.readdirSync(DATA), ...fs.readdirSync(path.join(DATA, 'books'))].filter((n) => /\.(tmp|part)$/.test(n));
    expect(leftovers).toEqual([]);
  });

  let savedFraction = 0;

  test('3. 翻页后关闭阅读窗口，进度已写盘', async () => {
    const reader = await waitPage(isReader);
    await reader.keyboard.press('PageDown');
    for (let i = 0; i < 6; i++) {
      await reader.waitForTimeout(450);
      await reader.keyboard.press('PageDown');
    }
    await reader.waitForTimeout(600);
    const loc = await currentLocation(reader);
    expect(loc?.fraction ?? 0).toBeGreaterThan(0);
    savedFraction = loc!.fraction;
    // 用兜底窗口按钮里的“关闭”，走 platform.window.close() → onCloseRequested → 保存 → 销毁
    await reader.locator('#fjd-fallback-chrome button.close, [aria-label="关闭"]').first().click();
    await expect.poll(() => pages().filter((p) => isReader(p.url())).length, { timeout: 15_000 }).toBe(0);
    // 主窗口还在
    expect(pages().some((p) => isLibrary(p.url()))).toBe(true);
    const lib = JSON.parse(fs.readFileSync(path.join(DATA, 'library.json'), 'utf8')) as {
      books: { progress?: { fraction: number } }[];
    };
    expect(lib.books[0]!.progress?.fraction).toBeCloseTo(savedFraction, 2);
  });

  test('4. 书库里再点开这本书，位置还在', async () => {
    const lib = await waitPage(isLibrary);
    await lib.getByTestId('book-card').getByRole('button').first().click().catch(async () => {
      await lib.getByRole('button', { name: /江南旧事/ }).first().click();
    });
    const reader = await waitPage(isReader);
    await waitReaderReady(reader);
    await reader.waitForTimeout(1000);
    const loc = await currentLocation(reader);
    expect(loc?.fraction).toBeCloseTo(savedFraction, 1);
    await reader.screenshot({ path: path.join(SHOTS, '04-reader-reopened.png') });
  });

  test('5. 再次打开同一本书只聚焦已有窗口；单实例转发第二本书', async () => {
    const lib = await waitPage(isLibrary);
    await lib.getByTestId('book-card').getByRole('button').first().click().catch(() => {});
    await lib.waitForTimeout(800);
    expect(pages().filter((p) => isReader(p.url()))).toHaveLength(1);
    // 第二个进程：参数转发给已运行的实例，自己退出
    const second = launch([SECOND]);
    await expect.poll(() => second.exitCode !== null || second.killed, { timeout: 20_000 }).toBe(true);
    await expect(lib.getByTestId('book-card')).toHaveCount(2, { timeout: 60_000 });
    await expect.poll(() => pages().filter((p) => isReader(p.url())).length, { timeout: 30_000 }).toBe(2);
    await lib.screenshot({ path: path.join(SHOTS, '05-library-two-books.png') });
    // txt：导入时拼成 epub 存为 <id>.epub，不留 .txt 副本
    const third = launch([path.join(ROOT, 'fixtures', 'txt', 'chapters-hant.txt')]);
    await expect.poll(() => third.exitCode !== null || third.killed, { timeout: 20_000 }).toBe(true);
    await expect(lib.getByTestId('book-card')).toHaveCount(3, { timeout: 60_000 });
    const names = fs.readdirSync(path.join(DATA, 'books'));
    expect(names.filter((n) => n.endsWith('.txt'))).toEqual([]);
    expect(names.filter((n) => n.endsWith('.epub')).length).toBe(2);
  });

  test('6. 关闭书库就是退出：阅读窗口随之关闭，进程结束', async () => {
    const lib = await waitPage(isLibrary);
    await lib.locator('#fjd-fallback-chrome button.close, [aria-label="关闭"]').first().click();
    await expect.poll(() => proc!.exitCode !== null, { timeout: 20_000 }).toBe(true);
  });
});
