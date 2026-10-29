// 首次运行自动注册的真机验证：用真实的 reg.exe 和 shell.writeShortcutLink，
// 但通过 FJD_REG_ROOT / FJD_SHORTCUT_DIR 把注册表和快捷方式写到测试专用的位置
// （HKCU\Software\FJD-Test\Classes 和临时目录），不碰真实的开始菜单、桌面和文件关联。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXE = process.env.FJD_EXE ?? path.resolve(here, '../release/繁体简读/繁体简读.exe');
const TEST_ROOT = 'HKCU\\Software\\FJD-Test';
const CLASSES = `${TEST_ROOT}\\Classes`;

const reg = (args: string[]): { code: number; out: string } => {
  const r = spawnSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe'), args);
  // reg.exe 的输出是系统代码页（中文系统是 GBK）
  return { code: r.status ?? -1, out: new TextDecoder('gb18030').decode(r.stdout) };
};

let tmp = '';
let app: ElectronApplication | null = null;

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  app = await electron.launch({
    executablePath: EXE,
    // 不带 --no-register：这里就是要测自动注册
    env: {
      ...process.env,
      FJD_USER_DATA: path.join(tmp, 'data'),
      FJD_SHORTCUT_DIR: path.join(tmp, 'shortcuts'),
      FJD_REG_ROOT: CLASSES,
    } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.getByTestId('library').waitFor();
  await page.waitForTimeout(500); // 等界面挂好键盘监听
  return { app, page };
}

async function quit(): Promise<void> {
  const a = app;
  app = null;
  if (a) await a.close().catch(() => {});
}

test.describe.serial('自动注册（测试专用的注册表位置和快捷方式目录）', () => {
  test.skip(!fs.existsSync(EXE), `没有 ${EXE}，先运行 pnpm --filter app pack:win`);

  test.beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fjd-reg-e2e-'));
    reg(['delete', TEST_ROOT, '/f']);
  });
  test.afterAll(async () => {
    await quit();
    reg(['delete', TEST_ROOT, '/f']);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const lnks = (): string[] => [path.join(tmp, 'shortcuts', 'start', '繁体简读.lnk'), path.join(tmp, 'shortcuts', 'desktop', '繁体简读.lnk')];

  test('1. 首次运行：创建快捷方式和文件关联；命令、图标、AppUserModelID 都对', async () => {
    const { app: a } = await launch();
    for (const l of lnks()) await expect.poll(() => fs.existsSync(l), { timeout: 20_000 }).toBe(true);
    const link = await a.evaluate(({ shell }, f) => shell.readShortcutLink(f), lnks()[0]!);
    expect(link.target).toBe(EXE);
    expect(link.icon).toBe(path.join(path.dirname(EXE), 'resources', 'icon.ico'));
    expect(link.appUserModelId).toBe('com.fantijiandu.reader');

    // 快捷方式先于文件关联写好；shell.json 出现就说明整个注册流程跑完了
    await expect.poll(() => fs.existsSync(path.join(tmp, 'data', 'shell.json')), { timeout: 20_000 }).toBe(true);
    const cmd = reg(['query', `${CLASSES}\\FantiJiandu.Book\\shell\\open\\command`, '/ve']);
    expect(cmd.code).toBe(0);
    expect(cmd.out).toContain(`"${EXE}" "%1"`);
    const icon = reg(['query', `${CLASSES}\\FantiJiandu.Book\\DefaultIcon`, '/ve']);
    expect(icon.out).toContain(`${path.join(path.dirname(EXE), 'resources', 'icon.ico')}",0`);
    for (const ext of ['.epub', '.mobi', '.azw3', '.fb2']) {
      expect(reg(['query', `${CLASSES}\\${ext}\\OpenWithProgids`]).out).toContain('FantiJiandu.Book');
      expect(reg(['query', `${CLASSES}\\${ext}`, '/ve']).out).toContain('FantiJiandu.Book');
    }
    expect(reg(['query', `${CLASSES}\\.txt`]).code).not.toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'shell.json'), 'utf8'))).toEqual({ autoRegister: true, registeredExe: EXE });
    await quit(); // 单实例：不退出的话，下一个测试的进程会被当成第二个实例直接退掉
  });

  test('2. 设置里的开关和“移除”按钮；移除后下次启动不再自动创建', async () => {
    const { page } = await launch();
    // 打开设置 → 关于
    await page.keyboard.press('Control+,');
    await page.getByTestId('settings').getByRole('button', { name: '关于' }).click();
    await expect(page.getByText('创建快捷方式和文件关联')).toBeVisible();
    fs.mkdirSync(path.resolve(here, '../../screenshots/M3e'), { recursive: true });
    await page.screenshot({ path: path.resolve(here, '../../screenshots/M3e/07-settings-about.png') });
    await page.getByTestId('desktop-remove').click();
    for (const l of lnks()) await expect.poll(() => fs.existsSync(l), { timeout: 20_000 }).toBe(false);
    await expect.poll(() => reg(['query', `${CLASSES}\\FantiJiandu.Book`]).code, { timeout: 20_000 }).not.toBe(0);
    // .epub 键本身会留着（只清掉指向我们的默认值和“打开方式”条目）
    expect(reg(['query', `${CLASSES}\\.epub`, '/ve']).out).not.toContain('FantiJiandu.Book');
    expect(reg(['query', `${CLASSES}\\.epub\\OpenWithProgids`]).out).not.toContain('FantiJiandu.Book');
    await expect(page.getByRole('switch', { name: '创建快捷方式和文件关联' })).toHaveAttribute('aria-checked', 'false');
    await quit();

    await launch();
    await new Promise((r) => setTimeout(r, 3000));
    for (const l of lnks()) expect(fs.existsSync(l)).toBe(false);
    expect(reg(['query', `${CLASSES}\\FantiJiandu.Book`]).code).not.toBe(0);
  });

  test('3. 重新打开开关：立即创建；文件夹移动后（registeredExe 与当前不同）启动时自动更新', async () => {
    const page = (app!.windows()[0])!;
    await page.keyboard.press('Control+,');
    await page.getByTestId('settings').getByRole('button', { name: '关于' }).click();
    await page.getByRole('switch', { name: '创建快捷方式和文件关联' }).click();
    for (const l of lnks()) await expect.poll(() => fs.existsSync(l), { timeout: 20_000 }).toBe(true);
    await quit();

    // 模拟“文件夹被移动过”：把记录的旧路径改掉，并把关联命令改成旧位置
    const sf = path.join(tmp, 'data', 'shell.json');
    fs.writeFileSync(sf, JSON.stringify({ autoRegister: true, registeredExe: 'C:\\旧位置\\繁体简读.exe' }));
    reg(['add', `${CLASSES}\\FantiJiandu.Book\\shell\\open\\command`, '/ve', '/d', '"C:\\旧位置\\繁体简读.exe" "%1"', '/f']);
    for (const l of lnks()) fs.rmSync(l);
    await launch();
    for (const l of lnks()) await expect.poll(() => fs.existsSync(l), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => reg(['query', `${CLASSES}\\FantiJiandu.Book\\shell\\open\\command`, '/ve']).out, { timeout: 20_000 }).toContain(`"${EXE}" "%1"`);
    // shell.json 在注册表写完之后才落盘，要轮询，不能立即读（这是此前偶发失败的原因）
    await expect.poll(() => JSON.parse(fs.readFileSync(sf, 'utf8')).registeredExe, { timeout: 20_000 }).toBe(EXE);
  });
});
