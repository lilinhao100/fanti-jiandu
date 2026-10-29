// 繁体简读 · Electron 主进程。只做前端做不了或不该做的事：
//   - 数据目录读写、导入（流式 sha256 + 复制）、fjd:// 协议（界面文件和书/封面/字体）
//   - 窗口：书库是主窗口，每本书一个阅读窗口；记住位置和大小；关闭前等渲染进程保存进度
//   - 单实例与“打开文件”转发；首次运行注册快捷方式和文件关联（只有 Windows；macOS 的文件关联写在 Info.plist 里）
//   - macOS（M4）：隐藏标题栏 + 系统红黄绿、中文菜单栏、open-file 事件（含拖到 Dock 图标）、关窗不退出、点 Dock 图标重开书库
// 不使用任何原生 Node 模块。官方 Electron 二进制原样使用。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, session, shell, nativeTheme } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { OpenFileQueue, parseFlags, pathsFromArgs } from './args';
import { APP_NAME, buildMenuTemplate } from './menu';
import { activateAction, canRegisterShell, closePlan, initialButtonsVisible, isMac, quitWhenAllClosed, usesWindowIcon, windowChrome } from './platform';
import { resolveAppFile, resolveServed } from './paths';
import {
  APP_ID,
  autoRegister,
  DEFAULT_CLASSES_ROOT,
  normalizeShellState,
  registerAll,
  registrationStatus,
  unregisterAll,
  type RegisterDeps,
  type ShellState,
} from './register';
import { FontService, IMPORT_EXTS } from './fonts';
import { DataStore } from './store';
import { loadWindowStates, restore, saveWindowStates, type WindowStates } from './windowState';

const flags = parseFlags(process.argv);
const userData = flags.userData ? path.resolve(flags.userData) : path.join(app.getPath('appData'), '繁体简读');
app.setPath('userData', userData);
// Chromium 自己的缓存、本地存储等放子目录，别和书库数据混在一起
app.setPath('sessionData', path.join(userData, 'browser'));
app.setAppUserModelId(APP_ID);

const SCHEME = 'fjd';
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const APP_ORIGIN = `${SCHEME}://app`;
const DATA_HOST = 'data';

// 与 Tauri 版 tauri.conf.json 的 CSP 等价：界面只能加载自己、blob 和 data
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline' blob:",
  `img-src 'self' ${SCHEME}: blob: data:`,
  `font-src 'self' ${SCHEME}: blob: data:`,
  "media-src 'self' blob: data:",
  `connect-src 'self' ${SCHEME}: blob: data:`,
  "frame-src 'self' blob: data:",
  "child-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.epub': 'application/epub+zip',
  '.txt': 'text/plain; charset=utf-8',
};

const store = new DataStore(userData);
const fonts = new FontService(userData);
const appRoot = path.join(app.getAppPath(), 'dist');

// ------------------------------------------------------------------ 状态
let mainWin: BrowserWindow | null = null;
const readers = new Map<string, BrowserWindow>();
/** 窗口 → 状态键（main / reader） */
const stateKey = new WeakMap<BrowserWindow, string>();
/** 已经完成关闭前保存、可以真正销毁的窗口 */
const closeAllowed = new WeakSet<BrowserWindow>();
const closing = new WeakSet<BrowserWindow>();
const openQueue = new OpenFileQueue();

const windowStateFile = path.join(userData, 'window-state.json');
let windowStates: WindowStates = {};

const iconPath = (): string =>
  app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(app.getAppPath(), '..', 'docs', 'icon', 'final', 'icon.ico');

// ------------------------------------------------------------------ 协议
function installProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
    const isApp = url.host === 'app';
    let file: string | null = null;
    if (isApp) file = resolveAppFile(appRoot, url.pathname);
    else if (url.host === DATA_HOST) file = resolveServed(userData, url.pathname);
    if (!file) return new Response('Forbidden', { status: 403 });
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(file);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      return new Response('Not Found', { status: 404 });
    }
    const headers: Record<string, string> = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Cache-Control': isApp ? 'no-cache' : 'no-store',
    };
    if (isApp) headers['Content-Security-Policy'] = CSP;
    else headers['Access-Control-Allow-Origin'] = APP_ORIGIN;
    if (request.method === 'HEAD') return new Response(null, { headers });
    return new Response(Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream, { headers });
  });
}

// ------------------------------------------------------------------ 窗口
function backgroundColor(): string {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')) as { appearance?: { mode?: string } };
    const mode = s.appearance?.mode;
    const dark = mode === 'dark' || (mode !== 'light' && nativeTheme.shouldUseDarkColors);
    return dark ? '#1E1E1E' : '#FFFFFF';
  } catch {
    return nativeTheme.shouldUseDarkColors ? '#1E1E1E' : '#FFFFFF';
  }
}

function saveState(win: BrowserWindow): void {
  const key = stateKey.get(win);
  if (!key || win.isDestroyed() || win.isMinimized()) return;
  const b = win.getNormalBounds();
  windowStates[key] = { ...b, maximized: win.isMaximized() };
  saveWindowStates(windowStateFile, windowStates);
}

function createWindow(kind: 'main' | 'reader', hash: string): BrowserWindow {
  const isMain = kind === 'main';
  const min = isMain ? { width: 760, height: 520 } : { width: 480, height: 360 };
  const def = isMain ? { width: 1144, height: 860 } : { width: 1000, height: 780 };
  const workAreas = screen.getAllDisplays().map((d) => d.workArea);
  const saved = restore(windowStates[kind], workAreas, min);
  const bounds: Partial<Electron.Rectangle> = saved?.bounds ?? def;
  // 已经有别的阅读窗口开在同一位置时错开一点，免得叠成一个
  if (!isMain && bounds.x !== undefined && bounds.y !== undefined) {
    const taken = [...readers.values()].filter((w) => !w.isDestroyed()).map((w) => w.getPosition());
    while (taken.some(([x, y]) => Math.abs(x! - bounds.x!) < 20 && Math.abs(y! - bounds.y!) < 20)) {
      bounds.x += 30;
      bounds.y += 30;
    }
  }

  const win = new BrowserWindow({
    ...bounds,
    width: bounds.width ?? def.width,
    height: bounds.height ?? def.height,
    minWidth: min.width,
    minHeight: min.height,
    ...windowChrome(),
    show: false,
    title: '繁体简读',
    // mac 的图标取自 .app 里的 icon.icns，不用传
    ...(usesWindowIcon() ? { icon: iconPath() } : {}),
    backgroundColor: backgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  stateKey.set(win, kind);
  // 高分屏（缩放 150%、250% 等）下，构造函数里的尺寸会被舍入多出几个像素，创建后再设一次才和保存的一致
  if (saved) {
    if (bounds.x !== undefined && bounds.y !== undefined) win.setBounds(bounds as Electron.Rectangle);
    else win.setSize(bounds.width ?? def.width, bounds.height ?? def.height);
  }
  win.webContents.setVisualZoomLevelLimits(1, 1);
  // mac：阅读窗口的工具栏一开始是隐藏的，红黄绿也一起隐藏；渲染进程之后随工具栏显示/隐藏再通知（fjd:win-buttons）
  if (isMac() && !initialButtonsVisible(process.platform, kind)) win.setWindowButtonVisibility(false);

  // 界面只允许待在 fjd://app；任何跳转和新窗口都拒绝（外链交给系统浏览器）
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => {
    if (saved?.maximized) win.maximize();
    win.show();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => saveState(win), 500);
  };
  win.on('resize', later);
  win.on('move', later);
  win.on('maximize', later);
  win.on('unmaximize', later);
  win.on('close', (e) => {
    if (closeAllowed.has(win)) return;
    e.preventDefault();
    void requestClose(win);
  });
  win.on('closed', () => {
    clearTimeout(timer);
    if (win === mainWin) mainWin = null;
    for (const [id, w] of readers) if (w === win) readers.delete(id);
  });

  void win.loadURL(`${APP_ORIGIN}/index.html${hash}`);
  return win;
}

/** 让渲染进程把进度等写盘；最多等 4 秒 */
function flushWindow(win: BrowserWindow): Promise<void> {
  const wc = win.webContents;
  if (win.isDestroyed() || wc.isDestroyed() || wc.isCrashed() || wc.isLoading()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      ipcMain.off('fjd:close-ack', onAck);
      resolve();
    };
    const onAck = (ev: IpcMainEvent): void => {
      if (ev.sender === wc) done();
    };
    const timer = setTimeout(done, 4000);
    ipcMain.on('fjd:close-ack', onAck);
    wc.send('fjd:before-close');
  });
}

function destroy(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  closeAllowed.add(win);
  win.destroy();
}

async function requestClose(win: BrowserWindow): Promise<void> {
  if (closing.has(win)) return;
  closing.add(win);
  try {
    saveState(win);
    const plan = closePlan(process.platform, win === mainWin);
    if (plan.closeOthers) {
      // Windows/Linux：书库是主窗口，它关闭就是退出，先让阅读窗口各自保存进度再关
      const others = [...readers.values()];
      await Promise.all([win, ...others].map(flushWindow));
      for (const w of others) destroy(w);
      destroy(win);
    } else {
      // 阅读窗口，或 macOS 上的书库窗口：只关它自己
      await flushWindow(win);
      destroy(win);
    }
    if (plan.quitApp) app.quit();
  } finally {
    closing.delete(win);
  }
}

function focusWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function openReader(id: string): void {
  if (!/^[A-Za-z0-9]{1,64}$/.test(id)) throw new Error(`非法的书 id：${id}`);
  const have = readers.get(id);
  if (have && !have.isDestroyed()) {
    focusWindow(have);
    return;
  }
  const win = createWindow('reader', `#/reader/${id}`);
  readers.set(id, win);
}

function notifyOpenFiles(): void {
  if (mainWin && !mainWin.isDestroyed() && !mainWin.webContents.isLoading()) mainWin.webContents.send('fjd:open-files');
}

/** 有新的待打开文件（或点了 Dock 图标）：书库窗口不在就开一个（它加载后会自己取走队列），在就提醒它取 */
function showLibrary(): void {
  if (!mainWin || mainWin.isDestroyed()) {
    mainWin = createWindow('main', '#/library');
    return;
  }
  focusWindow(mainWin);
  notifyOpenFiles();
}

// ------------------------------------------------------------------ macOS 菜单栏
function sendCommand(cmd: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? mainWin;
  if (win && !win.isDestroyed()) win.webContents.send('fjd:menu-command', cmd);
}

function installMacMenu(): void {
  app.setAboutPanelOptions({ applicationName: APP_NAME, applicationVersion: app.getVersion() });
  const template = buildMenuTemplate(
    {
      send: sendCommand,
      closeFocused: () => BrowserWindow.getFocusedWindow()?.close(),
      openDataFolder: () => void shell.openPath(userData),
    },
    process.platform,
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ 注册（快捷方式、文件关联）
function runReg(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    // 系统自带、有微软签名的 reg.exe；参数用数组传，不经过 shell
    const child = spawn(path.join(systemRoot, 'System32', 'reg.exe'), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.on('error', () => resolve({ code: -1, stdout: '' }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout: out }));
  });
}

function registerDeps(): RegisterDeps {
  // FJD_SHORTCUT_DIR / FJD_REG_ROOT：测试时把快捷方式和注册表写到别处，免得动真实的开始菜单和文件关联
  const testDir = process.env.FJD_SHORTCUT_DIR;
  return {
    exe: app.getPath('exe'),
    icon: iconPath(),
    appUserModelId: APP_ID,
    startMenuDir: testDir
      ? path.join(testDir, 'start')
      : path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    desktopDir: testDir ? path.join(testDir, 'desktop') : app.getPath('desktop'),
    classesRoot: process.env.FJD_REG_ROOT || DEFAULT_CLASSES_ROOT,
    writeShortcut: (file, opts) =>
      shell.writeShortcutLink(file, 'create', {
        target: opts.target,
        cwd: opts.cwd,
        icon: opts.icon,
        iconIndex: opts.iconIndex,
        description: opts.description,
        appUserModelId: opts.appUserModelId,
      }),
    removeFile: (file) => fsp.rm(file, { force: true }),
    fileExists: (file) => fs.existsSync(file),
    mkdir: async (dir) => void (await fsp.mkdir(dir, { recursive: true })),
    reg: runReg,
  };
}

const shellStateFile = path.join(userData, 'shell.json');
let shellState: ShellState = normalizeShellState(undefined);
function loadShellState(): void {
  try {
    shellState = normalizeShellState(JSON.parse(fs.readFileSync(shellStateFile, 'utf8')));
  } catch {
    shellState = normalizeShellState(undefined);
  }
}
function saveShellState(): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(shellStateFile, JSON.stringify(shellState));
}

/** 只有打包后的程序才注册：开发时 exe 是 node_modules 里的 electron.exe，不能登记成“繁体简读” */
const canRegister = (): boolean => canRegisterShell(process.platform, app.isPackaged);

async function autoRegisterOnStart(): Promise<void> {
  if (flags.noRegister || !canRegister()) return;
  try {
    const r = await autoRegister(registerDeps(), shellState);
    if (r.action !== 'skipped') {
      shellState = r.state;
      saveShellState();
    }
  } catch (e) {
    console.error('自动注册失败', e);
  }
}

// ------------------------------------------------------------------ IPC
/** 只信任来自我们自己界面的调用 */
function trusted(e: IpcMainEvent | IpcMainInvokeEvent): void {
  const url = e.senderFrame?.url ?? '';
  if (!url.startsWith(`${APP_ORIGIN}/`)) throw new Error(`拒绝来自 ${url || '未知来源'} 的调用`);
}

function handle<A extends unknown[], R>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, (e, ...args) => {
    trusted(e);
    return fn(e, ...(args as A));
  });
}

function on(channel: string, fn: (e: IpcMainEvent, ...args: any[]) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    try {
      trusted(e);
    } catch {
      return;
    }
    fn(e, ...args);
  });
}

/** 通知除发起者以外的所有窗口：书库、设置或导入的字体变了 */
function broadcastChange(origin: Electron.WebContents, kind: 'library' | 'settings' | 'fonts'): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.webContents !== origin && !w.isDestroyed()) w.webContents.send('fjd:data-changed', kind);
  }
}

const winOf = (e: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null => BrowserWindow.fromWebContents(e.sender);

function installIpc(): void {
  handle('fjd:read-json', (_e, rel: string) => store.readJson(rel));
  handle('fjd:write-json', (_e, rel: string, data: unknown) => store.writeJson(rel, data));
  handle('fjd:read-file', (_e, rel: string) => store.readFile(rel));
  handle('fjd:write-file', (_e, rel: string, bytes: Uint8Array) => store.writeFile(rel, bytes));
  handle('fjd:exists', (_e, rel: string) => store.exists(rel));
  handle('fjd:remove', (_e, rels: string[]) => store.remove(rels));
  handle('fjd:list-dir', (_e, dir: string) => store.listDir(dir));
  handle('fjd:import-paths', (_e, paths: string[]) => store.importPaths(paths.filter((p) => typeof p === 'string')));
  handle('fjd:pick-files', async (e) => {
    const win = winOf(e);
    const opts: Electron.OpenDialogOptions = {
      title: '添加图书',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '电子书', extensions: ['epub', 'mobi', 'azw3', 'azw', 'fb2', 'txt'] }],
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? [] : r.filePaths;
  });
  handle('fjd:open-reader', (_e, id: string) => openReader(id));
  handle('fjd:take-pending-open-files', () => openQueue.take());

  // 字体（M2d）：系统字体由主进程扫描，导入的字体复制进 fonts/，改动后通知其他窗口
  handle('fjd:fonts-list', () => fonts.list());
  handle('fjd:fonts-css', () => fonts.faceCss());
  handle('fjd:fonts-import', async (e) => {
    const win = winOf(e);
    const opts: Electron.OpenDialogOptions = {
      title: '导入字体',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '字体文件', extensions: IMPORT_EXTS }],
    };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || r.filePaths.length === 0) return [];
    const added = await fonts.importFiles(r.filePaths);
    if (added.length > 0) broadcastChange(e.sender, 'fonts');
    return added;
  });
  handle('fjd:fonts-remove', async (e, id: string) => {
    await fonts.remove(id);
    broadcastChange(e.sender, 'fonts');
  });

  on('fjd:data-changed', (e, kind: string) => {
    if (kind !== 'library' && kind !== 'settings' && kind !== 'fonts') return;
    broadcastChange(e.sender, kind);
  });

  on('fjd:win', (e, action: string) => {
    const win = winOf(e);
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'toggle-maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (action === 'close') win.close();
  });
  handle('fjd:win-is-maximized', (e) => winOf(e)?.isMaximized() ?? false);
  on('fjd:win-title', (e, title: string) => {
    if (typeof title === 'string') winOf(e)?.setTitle(title.slice(0, 200));
  });
  // macOS：阅读窗口工具栏隐藏/显示时，红黄绿一起隐藏/显示（其他系统没有这个方法）
  on('fjd:win-buttons', (e, visible: unknown) => {
    if (isMac() && typeof visible === 'boolean') winOf(e)?.setWindowButtonVisibility(visible);
  });

  handle('fjd:desktop-status', async () => {
    if (!canRegister()) return { supported: false, auto: shellState.autoRegister, shortcuts: false, associations: false };
    return { supported: true, auto: shellState.autoRegister, ...(await registrationStatus(registerDeps(), shellState.registeredExe)) };
  });
  handle('fjd:desktop-set-auto', async (_e, on: boolean) => {
    if (!canRegister()) return;
    if (on) {
      await registerAll(registerDeps());
      shellState = { autoRegister: true, registeredExe: app.getPath('exe') };
    } else {
      await unregisterAll(registerDeps());
      shellState = { autoRegister: false, registeredExe: null };
    }
    saveShellState();
  });
  handle('fjd:desktop-remove', async () => {
    if (!canRegister()) return;
    await unregisterAll(registerDeps());
    shellState = { autoRegister: false, registeredExe: null };
    saveShellState();
  });
}

// ------------------------------------------------------------------ 启动
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 第二个实例：参数已经由 second-instance 转交给第一个，自己退出
  app.quit();
} else {
  openQueue.pushAll(pathsFromArgs(process.argv));

  app.on('second-instance', (_e, argv, cwd) => {
    const paths = pathsFromArgs(argv, cwd);
    if (openQueue.pushAll(paths) > 0) notifyOpenFiles();
    if (mainWin && !mainWin.isDestroyed()) focusWindow(mainWin);
  });

  // macOS：双击 epub 等关联文件、拖到 Dock 图标上、“打开方式”都走这个事件。必须在 ready 之前注册——
  // 点文件启动程序时，事件可能比 ready 还早到；先排队，书库窗口起来后取走
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (!openQueue.push(filePath)) return;
    if (app.isReady()) showLibrary();
  });

  // 点 Dock 图标：没有窗口就重新打开书库（Mac 的惯例）
  app.on('activate', () => {
    if (!app.isReady()) return;
    if (activateAction(!!mainWin && !mainWin.isDestroyed(), BrowserWindow.getAllWindows().length) === 'create-main') showLibrary();
    else if (mainWin) focusWindow(mainWin);
  });

  // 全部窗口关闭后：Windows/Linux 退出；macOS 留着，Dock 图标还在
  app.on('window-all-closed', () => {
    if (quitWhenAllClosed()) app.quit();
  });

  // macOS 的 ⌘Q、Dock 菜单“退出”：先让所有窗口保存进度，再真正退出。（Windows/Linux 的退出走“关书库窗口”，上面 requestClose 已经处理）
  let quitAllowed = false;
  let quitting = false;
  app.on('before-quit', (e) => {
    if (!isMac() || quitAllowed) return;
    e.preventDefault();
    if (quitting) return;
    quitting = true;
    void (async () => {
      const all = BrowserWindow.getAllWindows();
      for (const w of all) saveState(w);
      await Promise.all(all.map(flushWindow));
      for (const w of all) destroy(w);
      quitAllowed = true;
      app.quit();
    })();
  });

  void app.whenReady().then(async () => {
    if (isMac()) installMacMenu();
    else Menu.setApplicationMenu(null);
    store.ensureDirs();
    loadShellState();
    windowStates = loadWindowStates(windowStateFile);
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    installProtocol();
    installIpc();
    mainWin = createWindow('main', '#/library');
    // 注册在窗口出来之后做，不拖慢启动
    void autoRegisterOnStart();
  });
}

