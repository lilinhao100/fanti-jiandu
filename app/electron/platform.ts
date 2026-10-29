// 平台分支（M4）：窗口外观、生命周期、哪些功能在哪个系统上做。纯函数，参数里带 platform，方便在单元测试里模拟 darwin。
import type { BrowserWindowConstructorOptions } from 'electron';

export const isMac = (platform: NodeJS.Platform = process.platform): boolean => platform === 'darwin';

/**
 * macOS 红黄绿按钮的位置（hiddenInset 下 trafficLightPosition，窗口内容坐标，左上角）。
 * 按图书的截图：三个按钮约 52px 宽，距左 17px，垂直居中在 52px 高的工具栏上（按钮 12px 高 → 顶边 20px）。
 * 渲染进程的 reader.css 给左工具栏让出 78px（17 + 52 + 约 9px 的间隙）。具体像素要在真 Mac 上核对。
 */
export const TRAFFIC_LIGHT_POSITION = { x: 17, y: 20 } as const;

/** 窗口的“外框”选项。Windows/Linux：无边框，界面自己画窗口按钮；macOS：隐藏标题栏但保留系统的红黄绿（hiddenInset） */
export function windowChrome(platform: NodeJS.Platform = process.platform): BrowserWindowConstructorOptions {
  if (isMac(platform)) return { titleBarStyle: 'hiddenInset', trafficLightPosition: { ...TRAFFIC_LIGHT_POSITION } };
  return { frame: false, autoHideMenuBar: true };
}

/** 窗口图标：mac 用 .app 里的 icon.icns（Dock 和窗口都取自 bundle），不用传；Windows 是 resources/icon.ico */
export const usesWindowIcon = (platform: NodeJS.Platform = process.platform): boolean => !isMac(platform);

/** 阅读窗口一开始工具栏是隐藏的，mac 上红黄绿也一开始就隐藏（和图书一致）；书库窗口始终显示 */
export const initialButtonsVisible = (platform: NodeJS.Platform, kind: 'main' | 'reader'): boolean => !(isMac(platform) && kind === 'reader');

/** 全部窗口关闭后是否退出：Windows/Linux 是；macOS 不退出（Dock 图标还在，点它重新打开书库，Mac 的惯例） */
export const quitWhenAllClosed = (platform: NodeJS.Platform = process.platform): boolean => !isMac(platform);

export interface ClosePlan {
  /** 先让其他窗口各自保存进度再一起关掉 */
  closeOthers: boolean;
  /** 关完之后退出程序 */
  quitApp: boolean;
}

/**
 * 关闭一个窗口时要做什么。书库是主窗口：
 *   Windows/Linux：它关闭就是退出（连带阅读窗口）；
 *   macOS：只关它自己；退出走 ⌘Q（见 main.ts 的 before-quit）。
 */
export function closePlan(platform: NodeJS.Platform, isMain: boolean): ClosePlan {
  if (isMain && !isMac(platform)) return { closeOthers: true, quitApp: true };
  return { closeOthers: false, quitApp: false };
}

/** 点 Dock 图标（activate）：没有任何窗口就重新打开书库；只剩阅读窗口时也补开书库，免得点了没反应；书库还在就把它提到前面 */
export function activateAction(hasMain: boolean, windowCount: number): 'create-main' | 'focus-main' {
  if (!hasMain || windowCount === 0) return 'create-main';
  return 'focus-main';
}

/** 快捷方式、文件关联：只有打包后的 Windows 程序才注册。mac 的文件关联写在 Info.plist 里（见 scripts/mac/info-plist.ts），不需要运行时注册 */
export const canRegisterShell = (platform: NodeJS.Platform, isPackaged: boolean): boolean => platform === 'win32' && isPackaged;
