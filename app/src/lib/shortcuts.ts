// 快捷键：一张表，Windows（Ctrl）和 macOS（⌘）共用（DESIGN 第 3 节；M4）。
// - commandOfKey：键盘事件 → 命令。mac 上主修饰键是 metaKey（⌘），其他系统是 ctrlKey；另一个修饰键、Alt 同时按着的不算。
// - shortcutText：命令 → 显示用的文字（Windows 写 Ctrl+Shift+D，mac 写 ⇧⌘D），按钮提示和菜单项共用。
// - 命令总线（emitCommand / onCommand）：macOS 的菜单栏项由主进程转成命令发给渲染进程，和键盘走同一条路。
import type { OsKind } from '../platform/os';
import { currentOs } from '../platform/os';

export type Command =
  | 'toggle-script' // 繁/简
  | 'toc'
  | 'search'
  | 'bookmark'
  | 'bookmarks-panel'
  | 'highlights-panel'
  | 'close-window'
  | 'add-books'
  | 'font-bigger'
  | 'font-smaller'
  | 'font-reset'
  | 'settings';

export const COMMANDS: readonly Command[] = [
  'toggle-script',
  'toc',
  'search',
  'bookmark',
  'bookmarks-panel',
  'highlights-panel',
  'close-window',
  'add-books',
  'font-bigger',
  'font-smaller',
  'font-reset',
  'settings',
];

export const isCommand = (s: unknown): s is Command => typeof s === 'string' && (COMMANDS as readonly string[]).includes(s);

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** 事件里按着的是“主修饰键”（mac：⌘，其他：Ctrl）而且没有另一个修饰键、没有 Alt */
export function hasPrimary(e: KeyLike, os: OsKind = currentOs()): boolean {
  return os === 'mac' ? e.metaKey && !e.ctrlKey && !e.altKey : e.ctrlKey && !e.metaKey && !e.altKey;
}

export function commandOfKey(e: KeyLike, os: OsKind = currentOs()): Command | null {
  if (!hasPrimary(e, os)) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // 字号：= + 小键盘加号 / - _ 小键盘减号 / 0（带不带 Shift 都算，⌘+ 在多数键盘上就是 ⇧⌘=）
  if (k === '=' || k === '+' || e.code === 'NumpadAdd') return 'font-bigger';
  if (k === '-' || k === '_' || e.code === 'NumpadSubtract') return 'font-smaller';
  if (k === '0' || e.code === 'Numpad0') return e.shiftKey ? null : 'font-reset';
  if (e.shiftKey) {
    if (k === 'd') return 'bookmarks-panel';
    if (k === 'n') return 'highlights-panel';
    return null;
  }
  switch (k) {
    case 'j':
      return 'toggle-script';
    case 't':
      return 'toc';
    case 'f':
      return 'search';
    case 'd':
      return 'bookmark';
    case 'w':
      return 'close-window';
    case 'o':
      return 'add-books';
    case ',':
      return 'settings';
    default:
      return e.code === 'Comma' ? 'settings' : null;
  }
}

// ------------------------------------------------------------------ 显示文字

interface Spec {
  key: string;
  shift?: boolean;
  /** mac 上的写法与 Windows 不同时才写（比如 Ctrl+= 在 mac 菜单里是 ⌘+） */
  macKey?: string;
}

const SPECS: Record<Command, Spec> = {
  'toggle-script': { key: 'J' },
  toc: { key: 'T' },
  search: { key: 'F' },
  bookmark: { key: 'D' },
  'bookmarks-panel': { key: 'D', shift: true },
  'highlights-panel': { key: 'N', shift: true },
  'close-window': { key: 'W' },
  'add-books': { key: 'O' },
  'font-bigger': { key: '=', macKey: '+' },
  'font-smaller': { key: '-' },
  'font-reset': { key: '0' },
  settings: { key: ',' },
};

/** Windows：Ctrl+Shift+D；macOS：⇧⌘D（修饰键顺序按 Apple 的习惯：⇧ 在 ⌘ 前） */
export function shortcutText(cmd: Command, os: OsKind = currentOs()): string {
  const s = SPECS[cmd];
  return os === 'mac' ? `${s.shift ? '⇧' : ''}⌘${s.macKey ?? s.key}` : `Ctrl+${s.shift ? 'Shift+' : ''}${s.key}`;
}

/** 按钮提示：“目录（Ctrl+T）” */
export const withShortcut = (label: string, cmd: Command, os: OsKind = currentOs()): string => `${label}（${shortcutText(cmd, os)}）`;

/** Electron 菜单的 accelerator 写法（主进程的菜单模板用，见 electron/menu.ts） */
export function accelerator(cmd: Command): string {
  const s = SPECS[cmd];
  const key = cmd === 'font-bigger' ? 'Plus' : s.key;
  return `${s.shift ? 'Shift+' : ''}CmdOrCtrl+${key}`;
}

// ------------------------------------------------------------------ 命令总线

type Listener = (cmd: Command) => void;
const listeners = new Set<Listener>();

/** 订阅命令（来自菜单栏）。返回取消订阅函数 */
export function onCommand(fn: Listener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function emitCommand(cmd: Command): void {
  for (const fn of [...listeners]) fn(cmd);
}
