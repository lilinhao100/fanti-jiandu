import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { COMMANDS, type Command } from '../src/lib/shortcuts';
import { APP_NAME, buildMenuTemplate } from './menu';

function make() {
  const sent: Command[] = [];
  const closed = vi.fn();
  const opened = vi.fn();
  const tpl = buildMenuTemplate({ send: (c) => sent.push(c), closeFocused: closed, openDataFolder: opened }, 'darwin');
  return { tpl, sent, closed, opened };
}

type Item = MenuItemConstructorOptions;
const sub = (m: Item): Item[] => (Array.isArray(m.submenu) ? m.submenu : []);
const find = (tpl: Item[], label: string): Item => {
  for (const top of tpl) for (const it of sub(top)) if (it.label === label) return it;
  throw new Error(`菜单里没有“${label}”`);
};

describe('macOS 菜单模板', () => {
  it('不是 darwin 就没有菜单', () => {
    expect(buildMenuTemplate({ send() {}, closeFocused() {}, openDataFolder() {} }, 'win32')).toEqual([]);
  });

  it('顶层顺序：繁体简读、文件、编辑、显示、窗口、帮助（全中文）', () => {
    const { tpl } = make();
    expect(tpl.map((m) => m.label)).toEqual([APP_NAME, '文件', '编辑', '显示', '窗口', '帮助']);
    expect(tpl[4]!.role).toBe('window');
    expect(tpl[5]!.role).toBe('help');
  });

  it('繁体简读菜单：关于、设置… ⌘,、隐藏、退出', () => {
    const { tpl } = make();
    const labels = sub(tpl[0]!).map((i) => i.label ?? (i.type === 'separator' ? '—' : ''));
    expect(labels).toEqual(['关于繁体简读', '—', '设置…', '—', '隐藏繁体简读', '隐藏其他', '全部显示', '—', '退出繁体简读']);
    expect(find(tpl, '设置…').accelerator).toBe('CmdOrCtrl+,');
    expect(sub(tpl[0]!).find((i) => i.role === 'quit')).toBeTruthy(); // ⌘Q 由系统角色提供
    expect(sub(tpl[0]!).find((i) => i.role === 'hide')).toBeTruthy();
  });

  it('文件菜单：添加图书… ⌘O、关闭窗口 ⌘W', () => {
    const { tpl } = make();
    expect(find(tpl, '添加图书…').accelerator).toBe('CmdOrCtrl+O');
    expect(find(tpl, '关闭窗口').accelerator).toBe('CmdOrCtrl+W');
  });

  it('显示菜单的快捷键：目录 ⌘T、书签 ⇧⌘D、要点精选 ⇧⌘N、繁/简 ⌘J、放大 ⌘+、缩小 ⌘-、实际大小 ⌘0、进入全屏', () => {
    const { tpl } = make();
    expect(find(tpl, '目录').accelerator).toBe('CmdOrCtrl+T');
    expect(find(tpl, '书签').accelerator).toBe('Shift+CmdOrCtrl+D');
    expect(find(tpl, '要点精选').accelerator).toBe('Shift+CmdOrCtrl+N');
    expect(find(tpl, '繁/简').accelerator).toBe('CmdOrCtrl+J');
    expect(find(tpl, '放大').accelerator).toBe('CmdOrCtrl+Plus');
    expect(find(tpl, '缩小').accelerator).toBe('CmdOrCtrl+-');
    expect(find(tpl, '实际大小').accelerator).toBe('CmdOrCtrl+0');
    expect(find(tpl, '进入全屏').role).toBe('togglefullscreen');
  });

  it('编辑菜单是标准项（撤销、重做、剪切、拷贝、粘贴、全选），走系统角色', () => {
    const { tpl } = make();
    const roles = sub(tpl[2]!).map((i) => i.role).filter(Boolean);
    expect(roles).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  });

  it('点菜单项会把对应命令发给渲染进程（和键盘快捷键同一条路）', () => {
    const { tpl, sent, closed, opened } = make();
    const click = (label: string): void => void (find(tpl, label).click as () => void)();
    click('设置…');
    click('添加图书…');
    click('目录');
    click('书签');
    click('要点精选');
    click('繁/简');
    click('放大');
    click('缩小');
    click('实际大小');
    click('在书中搜索');
    click('添加或删除书签');
    expect(sent).toEqual(['settings', 'add-books', 'toc', 'bookmarks-panel', 'highlights-panel', 'toggle-script', 'font-bigger', 'font-smaller', 'font-reset', 'search', 'bookmark']);
    click('关闭窗口');
    expect(closed).toHaveBeenCalledTimes(1);
    click('在 Finder 中显示数据文件夹');
    expect(opened).toHaveBeenCalledTimes(1);
    // 发出去的都是合法命令
    for (const c of sent) expect(COMMANDS).toContain(c);
  });

  it('没有两个菜单项抢同一个快捷键', () => {
    const { tpl } = make();
    const acc = tpl.flatMap((m) => sub(m)).map((i) => i.accelerator).filter(Boolean);
    expect(new Set(acc).size).toBe(acc.length);
  });
});
