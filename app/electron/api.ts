// preload 通过 contextBridge 暴露给渲染进程的最小接口（window.fjdElectron）。
// 渲染进程只 import type；两边靠这份类型对齐。
import type { RegistrationStatus } from './register';
import type { FontInfo } from '../src/model';
import type { ImportedFile } from './store';

export type { ImportedFile, RegistrationStatus };

export interface DesktopIntegration {
  /** 开关状态：是否自动创建快捷方式和文件关联；以及现在实际注册了没有 */
  status(): Promise<{ supported: boolean; auto: boolean } & RegistrationStatus>;
  /** 打开：立即创建快捷方式和文件关联，并记住“自动”；关闭：移除并不再自动创建 */
  setAuto(on: boolean): Promise<void>;
  /** 移除快捷方式和文件关联，并关掉“自动” */
  remove(): Promise<void>;
}

export interface FjdElectronApi {
  /** 主进程的 process.platform（'darwin' | 'win32' | 'linux'）。渲染进程据此切换 mac 的外观和快捷键 */
  platform: string;
  /** macOS 菜单栏点中了某个菜单项：命令名见 src/lib/commands.ts。其他系统没有菜单，永远不会触发 */
  onMenuCommand(cb: (command: string) => void): () => void;
  /** 数据目录里的相对路径，如 `library.json`、`books/<id>.epub`（主进程会再次校验） */
  readJson(rel: string): Promise<unknown>;
  writeJson(rel: string, data: unknown): Promise<void>;
  readFile(rel: string): Promise<Uint8Array>;
  writeFile(rel: string, bytes: Uint8Array): Promise<void>;
  exists(rel: string): Promise<boolean>;
  remove(rels: string[]): Promise<void>;
  listDir(dir: string): Promise<string[]>;
  /** 主进程流式计算 sha256 并复制进 books/ */
  importPaths(paths: string[]): Promise<ImportedFile[]>;
  pickFiles(): Promise<string[]>;
  openReader(id: string): Promise<void>;
  takePendingOpenFiles(): Promise<string[]>;
  onOpenFiles(cb: () => void): () => void;
  /** 通知其他窗口：书库、设置或导入的字体变了 */
  notifyChanged(kind: 'library' | 'settings' | 'fonts'): void;
  onDataChanged(cb: (kind: 'library' | 'settings' | 'fonts') => void): () => void;
  /** 字体（M2d）：系统字体由主进程扫描，导入的字体存在数据目录的 fonts/ */
  fonts: {
    list(): Promise<FontInfo[]>;
    /** 弹出系统文件选择框并导入；返回这次新增的家族 */
    import(): Promise<FontInfo[]>;
    remove(id: string): Promise<void>;
    css(): Promise<string>;
  };
  /** 窗口即将关闭：处理函数（保存进度等）完成后，窗口才会真正关闭 */
  onBeforeClose(handler: () => Promise<void>): void;
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    setTitle(t: string): void;
    /** macOS：显示或隐藏红黄绿按钮（阅读窗口的工具栏自动隐藏时一起隐藏）。其他系统不做事 */
    setButtonsVisible(visible: boolean): void;
  };
  desktop: DesktopIntegration;
}

declare global {
  interface Window {
    fjdElectron?: FjdElectronApi;
  }
}
