// 渲染进程判断“现在在哪个操作系统上”。整个窗口生命周期内不会变，所以模块加载时读一次就够。
//   - Electron：preload 暴露的 window.fjdElectron.platform（来自主进程的 process.platform）
//   - 测试：window.__FJD_OS__ = 'mac'（Playwright 的 addInitScript 在页面脚本之前注入，用来在浏览器里模拟 mac 模式）
//   - 其他（web、Tauri、node 单元测试）：windows（本项目原有的外观和快捷键）
// 纯函数都接受 os 参数，单元测试里直接传 'mac' 即可，不用改全局。
export type OsKind = 'windows' | 'mac';

declare global {
  interface Window {
    __FJD_OS__?: string;
  }
}

type OsSource = { __FJD_OS__?: string; fjdElectron?: { platform?: string } };

export function detectOs(w: OsSource | undefined = typeof window === 'undefined' ? undefined : window): OsKind {
  if (!w) return 'windows';
  if (w.__FJD_OS__ === 'mac' || w.__FJD_OS__ === 'windows') return w.__FJD_OS__;
  return w.fjdElectron?.platform === 'darwin' ? 'mac' : 'windows';
}

let cached: OsKind | null = null;
/** 当前系统（缓存）。单元测试里 window 不存在，永远是 windows */
export function currentOs(): OsKind {
  cached ??= detectOs();
  return cached;
}

/** 仅测试用：清掉缓存 */
export function resetOsCache(): void {
  cached = null;
}
