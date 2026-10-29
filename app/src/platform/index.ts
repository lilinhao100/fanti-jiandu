import { createElectronPlatform } from './electron';
import { createTauriPlatform } from './tauri';
import { createWebPlatform } from './web';
import type { Platform } from './types';

export type { Platform } from './types';

let instance: Platform | null = null;

/** 运行在 Tauri 的 WebView 里（Tauri 2 注入 __TAURI_INTERNALS__） */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 运行在 Electron 里（preload 注入 window.fjdElectron） */
export function isElectronRuntime(): boolean {
  return typeof window !== 'undefined' && 'fjdElectron' in window;
}

/** 前端唯一取得平台的入口。在 Electron 里用 electron 实现，Tauri 里用 tauri 实现，浏览器里用 web 实现。 */
export function getPlatform(): Platform {
  instance ??= isElectronRuntime() ? createElectronPlatform() : isTauriRuntime() ? createTauriPlatform() : createWebPlatform();
  return instance;
}

/** 测试用：替换平台实现 */
export function setPlatform(p: Platform | null): void {
  instance = p;
}
