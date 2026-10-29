import { useEffect, useState } from 'react';
import { Library } from './library/Library';
import { Reader } from './reader/Reader';
import { parseRoute, type Route } from './route';
import { useLibrary } from './store/library';
import { SettingsDialog } from './settings/SettingsDialog';
import { useFonts } from './store/fonts';
import { useSettings } from './store/settings';
import { useUi } from './store/ui';
import { commandOfKey, emitCommand, isCommand } from './lib/shortcuts';
import { getPlatform } from './platform';

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const notices = useLibrary((s) => s.notices);

  useEffect(() => {
    const onHash = (): void => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    void useSettings.getState().load();
    void useLibrary.getState().load();
  }, []);

  // 导入字体的 @font-face：界面里（字体页的预览）要用，阅读 iframe 里另外由 reader/styles.ts 注入
  const faceCss = useFonts((s) => s.faceCss);
  useEffect(() => {
    void useFonts.getState().ensureFaces();
  }, []);
  useEffect(() => {
    let el = document.getElementById('fjd-font-faces');
    if (!el) {
      el = document.createElement('style');
      el.id = 'fjd-font-faces';
      document.head.append(el);
    }
    el.textContent = faceCss;
  }, [faceCss]);

  // 页面模式：浅色、深色用 html[data-theme] 覆盖，自动就跟随系统（tokens.css）。
  // 也存一份在 localStorage，下次打开时 index.html 里的小脚本先于渲染套上，避免先白后黑的闪烁。
  const mode = useSettings((s) => s.settings.appearance.mode);
  const settingsLoaded = useSettings((s) => s.loaded);
  useEffect(() => {
    if (!settingsLoaded) return; // 存档读出来之前不动（默认值会冲掉 index.html 先套上的模式）
    const root = document.documentElement;
    if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
    else delete root.dataset.theme;
    try {
      localStorage.setItem('fjd:mode', mode);
    } catch {
      /* 隐私模式下可能不可用，不影响功能 */
    }
  }, [mode, settingsLoaded]);

  // Ctrl+, / ⌘,：打开设置（书库和阅读页都能用）；macOS 菜单栏的命令也从这里进入命令总线
  useEffect(() => {
    const toggleSettings = (): void => {
      const ui = useUi.getState();
      ui.setSettingsOpen(!ui.settingsOpen);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (commandOfKey(e) === 'settings') {
        e.preventDefault();
        toggleSettings();
      }
    };
    window.addEventListener('keydown', onKey);
    const off = getPlatform().onMenuCommand?.((c) => {
      if (!isCommand(c)) return;
      if (c === 'settings') toggleSettings();
      else emitCommand(c);
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      off?.();
    };
  }, []);

  // 从阅读页回到书库时，进度、最近阅读都变了，刷新一下
  useEffect(() => {
    if (route.name === 'library') {
      void useLibrary.getState().load();
      document.title = '繁体简读';
    }
  }, [route.name]);

  return (
    <>
      {route.name === 'reader' ? <Reader key={route.id} id={route.id} /> : <Library />}
      <SettingsDialog />
      <div className="notices" aria-live="polite">
        {notices.map((n) => (
          <div key={n.id} className={`notice glass ${n.kind}`} role={n.kind === 'error' ? 'alert' : 'status'}>
            {n.text}
          </div>
        ))}
      </div>
    </>
  );
}
