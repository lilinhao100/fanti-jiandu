import { describe, expect, it } from 'vitest';
import { activateAction, canRegisterShell, closePlan, initialButtonsVisible, isMac, quitWhenAllClosed, TRAFFIC_LIGHT_POSITION, usesWindowIcon, windowChrome } from './platform';

// 这些分支只能在真 Mac 上跑到；这里用“假装的 process.platform”把分支逻辑钉住
describe('平台分支：窗口外观', () => {
  it('macOS：隐藏标题栏 + 系统红黄绿（hiddenInset），不再无边框、不自画按钮', () => {
    const o = windowChrome('darwin');
    expect(o.titleBarStyle).toBe('hiddenInset');
    expect(o.trafficLightPosition).toEqual(TRAFFIC_LIGHT_POSITION);
    expect(o.frame).toBeUndefined();
  });
  it('Windows、Linux：无边框，菜单栏自动隐藏（界面自己画窗口按钮）', () => {
    for (const p of ['win32', 'linux'] as const) {
      expect(windowChrome(p)).toEqual({ frame: false, autoHideMenuBar: true });
    }
  });
  it('窗口图标只在非 mac 上传（mac 取自 .app 的 icon.icns）', () => {
    expect(usesWindowIcon('darwin')).toBe(false);
    expect(usesWindowIcon('win32')).toBe(true);
  });
  it('红黄绿一开始：阅读窗口隐藏（跟工具栏），书库窗口显示；非 mac 无所谓（恒为 true）', () => {
    expect(initialButtonsVisible('darwin', 'reader')).toBe(false);
    expect(initialButtonsVisible('darwin', 'main')).toBe(true);
    expect(initialButtonsVisible('win32', 'reader')).toBe(true);
  });
  it('红黄绿的位置落在 52px 高工具栏的垂直中心附近，并给左工具栏的 78px 让位留了余量', () => {
    // 按钮约 52×12：右边缘 = x + 52 必须 < 78
    expect(TRAFFIC_LIGHT_POSITION.x + 52).toBeLessThan(78);
    expect(TRAFFIC_LIGHT_POSITION.y + 6).toBe(26);
  });
  it('isMac', () => {
    expect(isMac('darwin')).toBe(true);
    expect(isMac('win32')).toBe(false);
  });
});

describe('平台分支：生命周期', () => {
  it('关闭所有窗口后：mac 不退出，其他系统退出', () => {
    expect(quitWhenAllClosed('darwin')).toBe(false);
    expect(quitWhenAllClosed('win32')).toBe(true);
    expect(quitWhenAllClosed('linux')).toBe(true);
  });
  it('关书库窗口：Windows 连带关阅读窗口并退出；mac 只关它自己', () => {
    expect(closePlan('win32', true)).toEqual({ closeOthers: true, quitApp: true });
    expect(closePlan('darwin', true)).toEqual({ closeOthers: false, quitApp: false });
  });
  it('关阅读窗口：任何系统都只关它自己', () => {
    for (const p of ['win32', 'darwin', 'linux'] as const) expect(closePlan(p, false)).toEqual({ closeOthers: false, quitApp: false });
  });
  it('点 Dock 图标：没有窗口或书库不在就重开书库，否则把书库提到前面', () => {
    expect(activateAction(false, 0)).toBe('create-main');
    expect(activateAction(false, 2)).toBe('create-main'); // 只剩阅读窗口：补开书库
    expect(activateAction(true, 0)).toBe('create-main'); // 状态不一致时也重开
    expect(activateAction(true, 3)).toBe('focus-main');
  });
});

describe('平台分支：快捷方式、文件关联', () => {
  it('只有打包后的 Windows 程序才注册；mac 全部跳过（文件关联在 Info.plist）', () => {
    expect(canRegisterShell('win32', true)).toBe(true);
    expect(canRegisterShell('win32', false)).toBe(false);
    expect(canRegisterShell('darwin', true)).toBe(false);
    expect(canRegisterShell('linux', true)).toBe(false);
  });
});
