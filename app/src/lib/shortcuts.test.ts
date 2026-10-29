import { describe, expect, it, vi } from 'vitest';
import { accelerator, COMMANDS, commandOfKey, emitCommand, hasPrimary, isCommand, onCommand, shortcutText, withShortcut, type Command, type KeyLike } from './shortcuts';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
const ctrl = (k: string, extra: Partial<KeyLike> = {}): KeyLike => key(k, { ctrlKey: true, ...extra });
const meta = (k: string, extra: Partial<KeyLike> = {}): KeyLike => key(k, { metaKey: true, ...extra });

describe('commandOfKey：Windows 用 Ctrl', () => {
  it.each<[string, Command]>([
    ['j', 'toggle-script'],
    ['t', 'toc'],
    ['f', 'search'],
    ['d', 'bookmark'],
    ['w', 'close-window'],
    ['o', 'add-books'],
    ['=', 'font-bigger'],
    ['+', 'font-bigger'],
    ['-', 'font-smaller'],
    ['0', 'font-reset'],
    [',', 'settings'],
  ])('Ctrl+%s → %s', (k, cmd) => {
    expect(commandOfKey(ctrl(k), 'windows')).toBe(cmd);
    expect(commandOfKey(ctrl(k.toUpperCase()), 'windows')).toBe(cmd); // CapsLock
  });
  it('Ctrl+Shift+D / N 是书签面板、要点精选', () => {
    expect(commandOfKey(ctrl('D', { shiftKey: true }), 'windows')).toBe('bookmarks-panel');
    expect(commandOfKey(ctrl('N', { shiftKey: true }), 'windows')).toBe('highlights-panel');
  });
  it('小键盘的加减零；Comma 按键位也认（输入法下 key 可能不是逗号）', () => {
    expect(commandOfKey(ctrl('Add', { code: 'NumpadAdd' }), 'windows')).toBe('font-bigger');
    expect(commandOfKey(ctrl('Subtract', { code: 'NumpadSubtract' }), 'windows')).toBe('font-smaller');
    expect(commandOfKey(ctrl('0', { code: 'Numpad0' }), 'windows')).toBe('font-reset');
    expect(commandOfKey(ctrl('Process', { code: 'Comma' }), 'windows')).toBe('settings');
  });
  it('⌘ 在 Windows 上不触发；Alt（含 AltGr = Ctrl+Alt）不触发；没有修饰键不触发', () => {
    expect(commandOfKey(meta('t'), 'windows')).toBeNull();
    expect(commandOfKey(ctrl('t', { altKey: true }), 'windows')).toBeNull();
    expect(commandOfKey(key('t'), 'windows')).toBeNull();
    expect(commandOfKey(ctrl('t', { metaKey: true }), 'windows')).toBeNull();
  });
  it('不认识的组合返回 null（交给别处）', () => {
    expect(commandOfKey(ctrl('c'), 'windows')).toBeNull();
    expect(commandOfKey(ctrl('x', { shiftKey: true }), 'windows')).toBeNull();
    expect(commandOfKey(ctrl('0', { shiftKey: true }), 'windows')).toBeNull();
  });
});

describe('commandOfKey：macOS 用 ⌘（metaKey）', () => {
  it.each<[string, Command]>([
    ['j', 'toggle-script'],
    ['t', 'toc'],
    ['f', 'search'],
    ['d', 'bookmark'],
    ['w', 'close-window'],
    ['o', 'add-books'],
    ['=', 'font-bigger'],
    ['-', 'font-smaller'],
    ['0', 'font-reset'],
    [',', 'settings'],
  ])('⌘%s → %s', (k, cmd) => {
    expect(commandOfKey(meta(k), 'mac')).toBe(cmd);
  });
  it('⇧⌘D、⇧⌘N；⌘+ 就是 ⇧⌘=（key 是 +，带 Shift）也是放大', () => {
    expect(commandOfKey(meta('D', { shiftKey: true }), 'mac')).toBe('bookmarks-panel');
    expect(commandOfKey(meta('N', { shiftKey: true }), 'mac')).toBe('highlights-panel');
    expect(commandOfKey(meta('+', { shiftKey: true }), 'mac')).toBe('font-bigger');
  });
  it('Ctrl 在 mac 上不触发（Ctrl+T 之类留给系统和文本编辑的 Emacs 键位）；⌥ 不触发', () => {
    expect(commandOfKey(ctrl('t'), 'mac')).toBeNull();
    expect(commandOfKey(meta('t', { altKey: true }), 'mac')).toBeNull();
    expect(commandOfKey(meta('t', { ctrlKey: true }), 'mac')).toBeNull();
    expect(commandOfKey(key('t'), 'mac')).toBeNull();
  });
  it('⌘C、⌘V 等系统复制粘贴不被认成命令', () => {
    for (const k of ['c', 'v', 'x', 'a', 'z']) expect(commandOfKey(meta(k), 'mac')).toBeNull();
  });
});

describe('hasPrimary', () => {
  it('按平台判断主修饰键', () => {
    expect(hasPrimary(ctrl('a'), 'windows')).toBe(true);
    expect(hasPrimary(meta('a'), 'windows')).toBe(false);
    expect(hasPrimary(meta('a'), 'mac')).toBe(true);
    expect(hasPrimary(ctrl('a'), 'mac')).toBe(false);
  });
});

describe('快捷键显示文字', () => {
  it('Windows：Ctrl+…；macOS：⌘…，Shift 写成 ⇧⌘', () => {
    expect(shortcutText('toc', 'windows')).toBe('Ctrl+T');
    expect(shortcutText('toc', 'mac')).toBe('⌘T');
    expect(shortcutText('bookmarks-panel', 'windows')).toBe('Ctrl+Shift+D');
    expect(shortcutText('bookmarks-panel', 'mac')).toBe('⇧⌘D');
    expect(shortcutText('highlights-panel', 'mac')).toBe('⇧⌘N');
    expect(shortcutText('toggle-script', 'mac')).toBe('⌘J');
    expect(shortcutText('font-bigger', 'windows')).toBe('Ctrl+=');
    expect(shortcutText('font-bigger', 'mac')).toBe('⌘+');
    expect(shortcutText('font-smaller', 'mac')).toBe('⌘-');
    expect(shortcutText('font-reset', 'mac')).toBe('⌘0');
    expect(shortcutText('settings', 'mac')).toBe('⌘,');
    expect(shortcutText('add-books', 'mac')).toBe('⌘O');
  });
  it('Windows 的提示文字和改动前完全一致（回归）', () => {
    expect(withShortcut('目录', 'toc', 'windows')).toBe('目录（Ctrl+T）');
    expect(withShortcut('书签列表', 'bookmarks-panel', 'windows')).toBe('书签列表（Ctrl+Shift+D）');
    expect(withShortcut('要点精选', 'highlights-panel', 'windows')).toBe('要点精选（Ctrl+Shift+N）');
    expect(withShortcut('显示原文', 'toggle-script', 'windows')).toBe('显示原文（Ctrl+J）');
    expect(withShortcut('在书中搜索', 'search', 'windows')).toBe('在书中搜索（Ctrl+F）');
    expect(withShortcut('添加书签', 'bookmark', 'windows')).toBe('添加书签（Ctrl+D）');
    expect(withShortcut('减小字号', 'font-smaller', 'windows')).toBe('减小字号（Ctrl+-）');
    expect(withShortcut('增大字号', 'font-bigger', 'windows')).toBe('增大字号（Ctrl+=）');
    expect(shortcutText('add-books', 'windows')).toBe('Ctrl+O');
  });
  it('菜单的 accelerator 写法', () => {
    expect(accelerator('toc')).toBe('CmdOrCtrl+T');
    expect(accelerator('bookmarks-panel')).toBe('Shift+CmdOrCtrl+D');
    expect(accelerator('font-bigger')).toBe('CmdOrCtrl+Plus');
    expect(accelerator('settings')).toBe('CmdOrCtrl+,');
  });
  it('每个命令都有显示文字和 accelerator', () => {
    for (const c of COMMANDS) {
      expect(shortcutText(c, 'mac')).toMatch(/^⇧?⌘./);
      expect(accelerator(c)).toContain('CmdOrCtrl+');
    }
  });
});

describe('命令总线', () => {
  it('订阅、发出、取消订阅；isCommand 只认合法命令', () => {
    const fn = vi.fn();
    const off = onCommand(fn);
    emitCommand('toc');
    expect(fn).toHaveBeenCalledWith('toc');
    off();
    emitCommand('toc');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isCommand('toc')).toBe(true);
    expect(isCommand('rm -rf')).toBe(false);
    expect(isCommand(undefined)).toBe(false);
  });
});
