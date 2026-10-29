// 平台适配层接口。以 docs/ARCHITECTURE.md 3.3 为准：前端只能通过它访问外部环境。
import type { BookAnnotations, BookRecord, FontInfo, ImportResult, Settings } from '../model';
import type { OsKind } from './os';

export type DataChangeKind = 'library' | 'settings' | 'fonts';

export interface Platform {
  kind: 'tauri' | 'web' | 'electron';
  /** 当前系统（M4；渲染进程统一用 platform/os.ts 的 currentOs()）：mac 上窗口按钮、快捷键（⌘）、字体、菜单栏都不同。web 里测试可用 window.__FJD_OS__ = 'mac' 模拟 */
  os?: OsKind;
  // 书库
  listBooks(): Promise<BookRecord[]>;
  /** web 传 File，tauri 传路径 */
  importFiles(input: File[] | string[]): Promise<ImportResult[]>;
  /** 交给 foliate 打开。文件名必须带正确的扩展名（foliate 靠它认 fb2） */
  readBookFile(id: string): Promise<File>;
  updateBook(id: string, patch: Partial<BookRecord>): Promise<void>;
  removeBook(id: string): Promise<void>;
  /** 返回可直接用作 <img src> 的 URL */
  saveCover(id: string, blob: Blob): Promise<string>;
  // 数据
  loadAnnotations(id: string): Promise<BookAnnotations>;
  saveAnnotations(id: string, a: BookAnnotations): Promise<void>;
  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  // 窗口
  openReader(id: string): Promise<void>;
  /**
   * 文件关联、单实例转发的打开请求。返回取消订阅函数。
   * web 实现永远不会触发回调：浏览器里的拖放由书库页面自己处理 File 对象。
   */
  onOpenFiles(cb: (paths: string[]) => void): () => void;
  /**
   * 其他窗口改了书库、设置或导入的字体（桌面外壳里书库窗口和各阅读窗口共用同一份存储；web 用 BroadcastChannel 通知其他标签页）。
   * 本窗口自己的改动不会触发回调。返回取消订阅函数。
   */
  onDataChanged?(cb: (kind: DataChangeKind) => void): () => void;
  pickFiles(): Promise<File[] | string[]>;
  // 字体（M2d）
  /**
   * 能选的字体：系统字体（electron：主进程扫描字体目录；tauri：Rust 的 fontdb；web：queryLocalFonts，没有授权就没有系统字体）
   * 加上导入的字体。同一个家族只出现一次。
   */
  listFonts(): Promise<FontInfo[]>;
  /** 弹出文件选择框，导入 .ttf .otf .ttc .woff .woff2。返回这次新导入的字体（同一个家族已经有就不重复） */
  importFonts(): Promise<FontInfo[]>;
  /** 只能删导入的字体（id 以 imp: 开头），其他的报错 */
  removeFont(id: string): Promise<void>;
  /** 导入字体的 @font-face 规则（url 用 fjd:// 协议、asset 协议或 blob），注入界面和阅读 iframe */
  fontFaceCss(): Promise<string>;
  /** macOS 菜单栏的点击（主进程把菜单项转成命令，见 lib/shortcuts.ts）。只有 electron 实现，且只在 mac 上会触发 */
  onMenuCommand?(cb: (command: string) => void): () => void;
  /** 桌面外壳的快捷方式、文件关联（只有 electron 实现，设置的“关于”页用） */
  desktop?: {
    status(): Promise<{ supported: boolean; auto: boolean; shortcuts: boolean; associations: boolean }>;
    setAuto(on: boolean): Promise<void>;
    remove(): Promise<void>;
  };
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): Promise<boolean>;
    setTitle(t: string): void;
    /** macOS 的红黄绿按钮：阅读窗口的工具栏自动隐藏时一起隐藏。只有 electron 的 mac 实现有 */
    setButtonsVisible?(visible: boolean): void;
  };
}
