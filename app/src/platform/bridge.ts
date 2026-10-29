// 把平台事件接到前端 store 上。由 main.tsx 在启动时调用一次。
//   - 其他窗口（桌面外壳）或其他标签页（web）改了书库、设置、导入的字体 → 本窗口重新加载，立即生效
//   - 书库窗口收到“打开这些文件”（文件关联双击、单实例转发）→ 导入并打开阅读窗口（只有桌面外壳）
//   - 界面没有自带窗口按钮和拖动区时，补一套兜底的（见 fallbackChrome.ts，只有 Tauri）
import { useFonts } from '../store/fonts';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { getPlatform } from './index';
import { installFallbackChrome } from './fallbackChrome';

export function startPlatformBridge(): void {
  const platform = getPlatform();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<string>();
  platform.onDataChanged?.((kind) => {
    pending.add(kind);
    clearTimeout(timer);
    // 阅读时进度每隔几秒就写一次，合并一下免得书库窗口反复刷新
    timer = setTimeout(() => {
      const kinds = [...pending];
      pending.clear();
      if (kinds.includes('library')) void useLibrary.getState().load();
      if (kinds.includes('settings')) void useSettings.getState().load();
      if (kinds.includes('fonts')) {
        void useFonts
          .getState()
          .reloadFaces()
          .then(() => useFonts.getState().refresh());
      }
    }, 250);
  });

  if (platform.kind === 'web') return;

  // 只有书库（主窗口）处理“打开文件”请求
  if (!window.location.hash.startsWith('#/reader/')) {
    platform.onOpenFiles((paths) => {
      void openPaths(paths);
    });
  }

  // Electron 的界面自带拖动区和窗口按钮（样式见 platform/electron.ts），不需要兜底
  if (platform.kind === 'tauri') installFallbackChrome();
}

async function openPaths(paths: string[]): Promise<void> {
  const platform = getPlatform();
  // store.importFiles 只是把参数转给 platform.importFiles，并负责刷新书库和提示；tauri 下传的是路径
  const results = await useLibrary.getState().importFiles(paths as unknown as File[]);
  for (const r of results) {
    if (r.ok) await platform.openReader(r.book.id);
  }
}
