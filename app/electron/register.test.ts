// 注册逻辑的单元测试：mock 掉 reg.exe 和 shell.writeShortcutLink，不碰真实的注册表和开始菜单
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_ID,
  ASSOC_EXTS,
  autoRegister,
  normalizeShellState,
  parseDefaultValue,
  PROG_ID,
  registerAll,
  registrationStatus,
  SHORTCUT_NAME,
  unregisterAll,
  type RegisterDeps,
  type ShortcutOptions,
} from './register';

const EXE = 'C:\\软件\\繁体简读\\繁体简读.exe';

function fake(overrides: Partial<RegisterDeps> = {}) {
  const regCalls: string[][] = [];
  const shortcuts: { file: string; opts: ShortcutOptions }[] = [];
  const files = new Set<string>();
  const removed: string[] = [];
  /** 极简的注册表：key → 默认值 */
  const registry = new Map<string, string>();
  const deps: RegisterDeps = {
    exe: EXE,
    icon: 'C:\\软件\\繁体简读\\resources\\icon.ico',
    appUserModelId: APP_ID,
    startMenuDir: 'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs',
    desktopDir: 'C:\\Users\\u\\Desktop',
    classesRoot: 'HKCU\\Software\\Classes',
    writeShortcut: (file, opts) => {
      shortcuts.push({ file, opts });
      files.add(file);
      return true;
    },
    removeFile: async (f) => void (files.delete(f), removed.push(f)),
    fileExists: (f) => files.has(f),
    mkdir: async () => {},
    reg: async (args) => {
      regCalls.push(args);
      const [op, key] = args as [string, string];
      if (op === 'add' && args.includes('/ve')) registry.set(key, args[args.indexOf('/d') + 1]!);
      if (op === 'delete' && args.includes('/ve')) registry.delete(key);
      if (op === 'delete' && !args.includes('/v') && !args.includes('/ve')) {
        for (const k of [...registry.keys()]) if (k === key || k.startsWith(`${key}\\`)) registry.delete(k);
      }
      if (op === 'query') {
        const v = registry.get(key);
        return v === undefined
          ? { code: 1, stdout: '' }
          : { code: 0, stdout: `\r\n${key}\r\n    (默认)    REG_SZ    ${v}\r\n\r\n` };
      }
      return { code: 0, stdout: '' };
    },
    ...overrides,
  };
  return { deps, regCalls, shortcuts, files, removed, registry };
}

describe('registerAll', () => {
  it('在开始菜单和桌面创建指向 exe 的快捷方式，图标和 AppUserModelID 都对', async () => {
    const f = fake();
    await registerAll(f.deps);
    expect(f.shortcuts.map((s) => s.file)).toEqual([
      path.join(f.deps.startMenuDir, SHORTCUT_NAME),
      path.join(f.deps.desktopDir, SHORTCUT_NAME),
    ]);
    for (const s of f.shortcuts) {
      expect(s.opts).toMatchObject({
        target: EXE,
        cwd: path.dirname(EXE),
        icon: f.deps.icon,
        iconIndex: 0,
        appUserModelId: 'com.fantijiandu.reader',
      });
    }
  });

  it('只写 HKCU 下的 ProgID 和四个扩展名，命令是 "<exe>" "%1"，txt 不注册', async () => {
    const f = fake();
    await registerAll(f.deps);
    expect(f.regCalls.every((a) => a[1]!.startsWith('HKCU\\Software\\Classes'))).toBe(true);
    expect(f.registry.get(`HKCU\\Software\\Classes\\${PROG_ID}\\shell\\open\\command`)).toBe(`"${EXE}" "%1"`);
    expect(f.registry.get(`HKCU\\Software\\Classes\\${PROG_ID}\\DefaultIcon`)).toBe(`"${f.deps.icon}",0`);
    expect(ASSOC_EXTS).toEqual(['.epub', '.mobi', '.azw3', '.fb2']);
    for (const ext of ASSOC_EXTS) {
      expect(f.regCalls).toContainEqual(['add', `HKCU\\Software\\Classes\\${ext}\\OpenWithProgids`, '/v', PROG_ID, '/t', 'REG_NONE', '/f']);
      expect(f.registry.get(`HKCU\\Software\\Classes\\${ext}`)).toBe(PROG_ID);
    }
    expect(f.regCalls.flat().some((a) => a.includes('.txt'))).toBe(false);
  });

  it('只通过 reg.exe 的参数数组写注册表（每次调用都是字符串数组，没有拼接成命令行）', async () => {
    const f = fake();
    await registerAll(f.deps);
    for (const a of f.regCalls) {
      expect(['add', 'query', 'delete']).toContain(a[0]);
      expect(a.every((x) => typeof x === 'string')).toBe(true);
    }
  });

  it('扩展名已被别的程序占为默认时，不抢默认，只加入“打开方式”', async () => {
    const f = fake();
    f.registry.set('HKCU\\Software\\Classes\\.epub', 'Calibre.epub');
    await registerAll(f.deps);
    expect(f.registry.get('HKCU\\Software\\Classes\\.epub')).toBe('Calibre.epub');
    expect(f.regCalls).toContainEqual(['add', 'HKCU\\Software\\Classes\\.epub\\OpenWithProgids', '/v', PROG_ID, '/t', 'REG_NONE', '/f']);
    expect(f.registry.get('HKCU\\Software\\Classes\\.mobi')).toBe(PROG_ID);
  });

  it('快捷方式创建失败就报错', async () => {
    const f = fake({ writeShortcut: () => false });
    await expect(registerAll(f.deps)).rejects.toThrow('快捷方式');
  });

  it('reg.exe 失败就报错', async () => {
    const f = fake({ reg: async () => ({ code: 1, stdout: '' }) });
    await expect(registerAll(f.deps)).rejects.toThrow('reg');
  });
});

describe('unregisterAll', () => {
  it('撤掉快捷方式、ProgID 和指向我们的默认关联，别人的默认关联不动', async () => {
    const f = fake();
    f.registry.set('HKCU\\Software\\Classes\\.epub', 'Calibre.epub');
    await registerAll(f.deps);
    await unregisterAll(f.deps);
    expect(f.removed).toHaveLength(2);
    expect([...f.registry.keys()].some((k) => k.includes(PROG_ID))).toBe(false);
    expect(f.registry.get('HKCU\\Software\\Classes\\.epub')).toBe('Calibre.epub');
    expect(f.registry.has('HKCU\\Software\\Classes\\.mobi')).toBe(false);
  });

  it('某一步失败不影响后面的步骤', async () => {
    const f = fake();
    await registerAll(f.deps);
    const calls: string[][] = [];
    const d: RegisterDeps = {
      ...f.deps,
      removeFile: async () => {
        throw new Error('占用中');
      },
      reg: async (a) => {
        calls.push(a);
        return { code: 1, stdout: '' };
      },
    };
    await unregisterAll(d);
    expect(calls.some((c) => c[1] === `HKCU\\Software\\Classes\\${PROG_ID}`)).toBe(true);
  });
});

describe('registrationStatus', () => {
  it('注册前两项都为假；注册后为真；记录的 exe 路径与当前不同时关联算过期', async () => {
    const f = fake();
    expect(await registrationStatus(f.deps, null)).toEqual({ shortcuts: false, associations: false });
    await registerAll(f.deps);
    expect(await registrationStatus(f.deps, EXE)).toEqual({ shortcuts: true, associations: true });
    expect((await registrationStatus(f.deps, 'E:\\别处\\繁体简读.exe')).associations).toBe(false);
  });
});

describe('autoRegister', () => {
  it('第一次运行：注册并记下 exe 路径', async () => {
    const f = fake();
    const r = await autoRegister(f.deps, normalizeShellState(undefined));
    expect(r.action).toBe('registered');
    expect(r.state).toEqual({ autoRegister: true, registeredExe: EXE });
    expect(f.shortcuts).toHaveLength(2);
  });

  it('路径没变：什么也不做（用户删掉桌面快捷方式后不会被重建）', async () => {
    const f = fake();
    const r = await autoRegister(f.deps, { autoRegister: true, registeredExe: EXE.toLowerCase() });
    expect(r.action).toBe('skipped');
    expect(f.shortcuts).toHaveLength(0);
    expect(f.regCalls).toHaveLength(0);
  });

  it('文件夹被移动：更新快捷方式和关联', async () => {
    const f = fake();
    const r = await autoRegister(f.deps, { autoRegister: true, registeredExe: 'C:\\旧位置\\繁体简读.exe' });
    expect(r.action).toBe('updated');
    expect(r.state.registeredExe).toBe(EXE);
    expect(f.registry.get(`HKCU\\Software\\Classes\\${PROG_ID}\\shell\\open\\command`)).toBe(`"${EXE}" "%1"`);
  });

  it('用户关掉了自动注册：不动', async () => {
    const f = fake();
    const r = await autoRegister(f.deps, { autoRegister: false, registeredExe: null });
    expect(r.action).toBe('skipped');
    expect(f.shortcuts).toHaveLength(0);
  });
});

describe('parseDefaultValue / normalizeShellState', () => {
  it('解析 reg query 的输出，未设置返回 undefined（与系统语言无关）', () => {
    expect(parseDefaultValue('\r\nHKEY\r\n    (默认)    REG_SZ    Foo.Bar\r\n')).toBe('Foo.Bar');
    expect(parseDefaultValue('    (Default)    REG_SZ    "C:\\a b\\x.exe" "%1"')).toBe('"C:\\a b\\x.exe" "%1"');
    expect(parseDefaultValue('    (Default)    REG_SZ    (value not set)')).toBeUndefined();
    expect(parseDefaultValue('    (默认)    REG_SZ    (数值未设置)')).toBeUndefined();
    expect(parseDefaultValue('')).toBeUndefined();
  });
  it('坏数据退回默认', () => {
    expect(normalizeShellState(null)).toEqual({ autoRegister: true, registeredExe: null });
    expect(normalizeShellState({ autoRegister: false, registeredExe: 3 })).toEqual({ autoRegister: false, registeredExe: null });
  });
});
