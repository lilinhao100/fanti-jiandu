// 首次运行时的自动注册：开始菜单和桌面快捷方式、.epub/.mobi/.azw3/.fb2 的文件关联。
// 全部依赖通过 RegisterDeps 注入，单元测试里 mock 掉 reg.exe 和 shell.writeShortcutLink。
// 只写 HKCU，不需要管理员权限。写注册表用系统自带、有微软签名的 reg.exe，参数用数组传，不经过 shell。
import path from 'node:path';

export const PROG_ID = 'FantiJiandu.Book';
export const ASSOC_EXTS = ['.epub', '.mobi', '.azw3', '.fb2'] as const;
export const SHORTCUT_NAME = '繁体简读.lnk';
export const APP_ID = 'com.fantijiandu.reader';

export interface ShortcutOptions {
  target: string;
  cwd: string;
  icon: string;
  iconIndex: number;
  description: string;
  appUserModelId: string;
}

export interface RegisterDeps {
  /** 繁体简读.exe 的完整路径 */
  exe: string;
  /** resources/icon.ico */
  icon: string;
  appUserModelId: string;
  /** 开始菜单“程序”文件夹 */
  startMenuDir: string;
  desktopDir: string;
  /** 注册表根，正常是 HKCU\Software\Classes；测试里可换成别处 */
  classesRoot: string;
  writeShortcut(file: string, opts: ShortcutOptions): boolean;
  removeFile(file: string): Promise<void>;
  fileExists(file: string): boolean;
  mkdir(dir: string): Promise<void>;
  reg(args: string[]): Promise<{ code: number; stdout: string }>;
}

export const DEFAULT_CLASSES_ROOT = 'HKCU\\Software\\Classes';

const samePath = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

const openCommand = (exe: string): string => `"${exe}" "%1"`;
const shortcutFiles = (d: RegisterDeps): string[] => [
  path.join(d.startMenuDir, SHORTCUT_NAME),
  path.join(d.desktopDir, SHORTCUT_NAME),
];

async function regOk(d: RegisterDeps, args: string[]): Promise<void> {
  const r = await d.reg(args);
  if (r.code !== 0) throw new Error(`reg ${args[0]} 失败（${r.code}）：${args[1] ?? ''}`);
}

/** 从 `reg query ... /ve` 的输出里取出默认值；没设置返回 undefined。输出的标签随系统语言变化，所以只看 REG_SZ 之后 */
export function parseDefaultValue(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const m = /REG_SZ\s+(.*)$/.exec(line);
    if (m) {
      const v = m[1]!.trim();
      return v === '' || v.startsWith('(') ? undefined : v;
    }
  }
  return undefined;
}

export async function createShortcuts(d: RegisterDeps): Promise<void> {
  for (const file of shortcutFiles(d)) {
    await d.mkdir(path.dirname(file));
    const ok = d.writeShortcut(file, {
      target: d.exe,
      cwd: path.dirname(d.exe),
      icon: d.icon,
      iconIndex: 0,
      description: '繁体简读',
      appUserModelId: d.appUserModelId,
    });
    if (!ok) throw new Error(`无法创建快捷方式：${file}`);
  }
}

export async function registerAssociations(d: RegisterDeps): Promise<void> {
  const prog = `${d.classesRoot}\\${PROG_ID}`;
  await regOk(d, ['add', prog, '/ve', '/d', '繁体简读电子书', '/f']);
  await regOk(d, ['add', `${prog}\\DefaultIcon`, '/ve', '/d', `"${d.icon}",0`, '/f']);
  await regOk(d, ['add', `${prog}\\shell\\open\\command`, '/ve', '/d', openCommand(d.exe), '/f']);
  for (const ext of ASSOC_EXTS) {
    const key = `${d.classesRoot}\\${ext}`;
    // 出现在“打开方式”列表里
    await regOk(d, ['add', `${key}\\OpenWithProgids`, '/v', PROG_ID, '/t', 'REG_NONE', '/f']);
    // 这个扩展名还没有默认程序时，才把我们设为默认；别人已经占着的，不抢
    const q = await d.reg(['query', key, '/ve']);
    if (q.code !== 0 || parseDefaultValue(q.stdout) === undefined) {
      await regOk(d, ['add', key, '/ve', '/d', PROG_ID, '/f']);
    }
  }
}

export async function registerAll(d: RegisterDeps): Promise<void> {
  await createShortcuts(d);
  await registerAssociations(d);
}

/** 撤销全部：快捷方式、ProgID、“打开方式”条目，以及指向我们的默认关联。每一步失败都不影响后面的 */
export async function unregisterAll(d: RegisterDeps): Promise<void> {
  for (const f of shortcutFiles(d)) await d.removeFile(f).catch(() => {});
  for (const ext of ASSOC_EXTS) {
    const key = `${d.classesRoot}\\${ext}`;
    const q = await d.reg(['query', key, '/ve']);
    if (q.code === 0 && parseDefaultValue(q.stdout) === PROG_ID) {
      await d.reg(['delete', key, '/ve', '/f']);
    }
    await d.reg(['delete', `${key}\\OpenWithProgids`, '/v', PROG_ID, '/f']);
  }
  await d.reg(['delete', `${d.classesRoot}\\${PROG_ID}`, '/f']);
}

export interface RegistrationStatus {
  shortcuts: boolean;
  associations: boolean;
}

/**
 * 现在注册了什么。reg.exe 的输出用系统代码页（中文系统是 GBK），路径里有中文时没法可靠地解码来比较命令行，
 * 所以关联是否“指向当前 exe”靠我们自己记录的 registeredExe 判断（启动时路径变了会自动更新），这里只看键在不在。
 */
export async function registrationStatus(d: RegisterDeps, registeredExe?: string | null): Promise<RegistrationStatus> {
  const shortcuts = shortcutFiles(d).some((f) => d.fileExists(f));
  const q = await d.reg(['query', `${d.classesRoot}\\${PROG_ID}\\shell\\open\\command`, '/ve']);
  const associations = q.code === 0 && (registeredExe === undefined || (registeredExe !== null && samePath(registeredExe, d.exe)));
  return { shortcuts, associations };
}

/** 保存在数据目录 shell.json 里的状态（不放进 settings.json，免得碰共享的 Settings 模型） */
export interface ShellState {
  /** 是否在启动时自动注册 / 路径变化时自动更新 */
  autoRegister: boolean;
  /** 上次注册时 exe 所在的路径；与当前不同说明文件夹被移动过 */
  registeredExe: string | null;
}

export const DEFAULT_SHELL_STATE: ShellState = { autoRegister: true, registeredExe: null };

export function normalizeShellState(raw: unknown): ShellState {
  const r = (raw ?? {}) as Partial<ShellState>;
  return {
    autoRegister: r.autoRegister !== false,
    registeredExe: typeof r.registeredExe === 'string' ? r.registeredExe : null,
  };
}


/**
 * 启动时调用：首次运行，或文件夹被移动后，注册 / 更新快捷方式和关联。
 * 用户关掉了开关就什么也不做；已经注册过且路径没变也不动（用户删掉桌面快捷方式后不会每次重建）。
 */
export async function autoRegister(
  d: RegisterDeps,
  state: ShellState,
): Promise<{ action: 'skipped' | 'registered' | 'updated'; state: ShellState }> {
  if (!state.autoRegister) return { action: 'skipped', state };
  if (state.registeredExe && samePath(state.registeredExe, d.exe)) return { action: 'skipped', state };
  const moved = state.registeredExe !== null;
  await registerAll(d);
  return { action: moved ? 'updated' : 'registered', state: { ...state, registeredExe: d.exe } };
}
