// macOS 菜单栏（中文）。只在 darwin 上用；Windows/Linux 没有菜单栏（Menu.setApplicationMenu(null)）。
// 菜单项分两类：
//   - 系统角色（隐藏、退出、撤销/剪切/拷贝/粘贴、最小化……）：交给系统，我们只改中文标签；
//   - 我们的命令（添加图书、目录、书签、繁/简、字号……）：点击后由主进程转成命令发给当前窗口的渲染进程
//     （命令名见 src/lib/shortcuts.ts），键盘快捷键（⌘）和菜单点击走同一条路。
// macOS 上带 accelerator 的菜单项会先于页面接到按键，页面收不到对应的 keydown，所以这里必须把每个快捷键都转成命令。
import type { MenuItemConstructorOptions } from 'electron';
import { accelerator, type Command } from '../src/lib/shortcuts';

export const APP_NAME = '繁体简读';

export interface MenuHandlers {
  /** 把命令发给当前窗口的渲染进程 */
  send(cmd: Command): void;
  /** 关闭当前窗口（走“先保存进度再销毁”的流程） */
  closeFocused(): void;
  /** 在 Finder 里显示数据目录 */
  openDataFolder(): void;
}

export function buildMenuTemplate(h: MenuHandlers, platform: NodeJS.Platform = process.platform): MenuItemConstructorOptions[] {
  if (platform !== 'darwin') return [];
  const cmd = (label: string, c: Command, extra: Partial<MenuItemConstructorOptions> = {}): MenuItemConstructorOptions => ({
    label,
    accelerator: accelerator(c),
    click: () => h.send(c),
    ...extra,
  });
  return [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `关于${APP_NAME}` },
        { type: 'separator' },
        cmd('设置…', 'settings'),
        { type: 'separator' },
        { role: 'hide', label: `隐藏${APP_NAME}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: `退出${APP_NAME}` },
      ],
    },
    {
      label: '文件',
      submenu: [
        cmd('添加图书…', 'add-books'),
        { type: 'separator' },
        { label: '关闭窗口', accelerator: accelerator('close-window'), click: () => h.closeFocused() },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        cmd('在书中搜索', 'search'),
      ],
    },
    {
      label: '显示',
      submenu: [
        cmd('目录', 'toc'),
        cmd('书签', 'bookmarks-panel'),
        cmd('要点精选', 'highlights-panel'),
        { type: 'separator' },
        cmd('添加或删除书签', 'bookmark'),
        cmd('繁/简', 'toggle-script'),
        { type: 'separator' },
        cmd('放大', 'font-bigger'),
        cmd('缩小', 'font-smaller'),
        cmd('实际大小', 'font-reset'),
        { type: 'separator' },
        { role: 'togglefullscreen', label: '进入全屏' },
      ],
    },
    {
      label: '窗口',
      role: 'window',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' },
      ],
    },
    {
      label: '帮助',
      role: 'help',
      submenu: [{ label: '在 Finder 中显示数据文件夹', click: () => h.openDataFolder() }],
    },
  ];
}
