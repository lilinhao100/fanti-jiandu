import { ArrowUUpLeft, BookmarkSimple, BookmarksSimple, CaretLeft, CaretRight, ListBullets, MagnifyingGlass, Notebook, Books } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '../model';
import { commandOfKey, hasPrimary, onCommand, withShortcut, type Command } from '../lib/shortcuts';
import { getPlatform } from '../platform';
import { currentOs } from '../platform/os';
import { useFonts } from '../store/fonts';
import { useLibrary } from '../store/library';
import { useReaderStore } from '../store/reader';
import { useSettings } from '../store/settings';
import { WindowControls } from '../ui/WindowControls';
import { ReaderController, type PointerInfo } from './controller';
import { AppearancePanel } from './panels/AppearancePanel';
import { BookmarkPanel } from './panels/BookmarkPanel';
import { HighlightsPanel } from './panels/HighlightsPanel';
import { SearchPanel } from './panels/SearchPanel';
import { NotePopover } from './NotePopover';
import { SelectionMenu } from './SelectionMenu';
import { TocPanel } from './panels/TocPanel';
import { stepFontSize } from './fonts';
import { resolvePalette } from './styles';

/** 工具栏何时出现 / 隐藏：DESIGN 2.2 */
const TOP_ZONE = 64;
const HIDE_DELAY_MS = 1200;
const EDGE_ZONE = 80;

type PanelId = 'toc' | 'bookmarks' | 'search' | 'appearance' | 'highlights';

/** 系统是否深色（页面模式为“自动”时正文配色要用） */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = (): void => setDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}

/** 正在输入文字时，方向键、空格等留给输入框，不翻页 */
function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function Reader({ id }: { id: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<ReaderController | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const panelOpen = useRef(false);
  const tocBtn = useRef<HTMLButtonElement>(null);
  const bmBtn = useRef<HTMLButtonElement>(null);
  const sizeBtn = useRef<HTMLButtonElement>(null);
  const searchBtn = useRef<HTMLButtonElement>(null);
  const [chrome, setChrome] = useState(false);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [edge, setEdge] = useState<'left' | 'right' | null>(null);
  const [searchFocus, setSearchFocus] = useState(0);

  const status = useReaderStore((s) => s.status);
  const error = useReaderStore((s) => s.error);
  const title = useReaderStore((s) => s.title);
  const toc = useReaderStore((s) => s.toc);
  const currentHref = useReaderStore((s) => s.currentHref);
  const display = useReaderStore((s) => s.display);
  const traditional = useReaderStore((s) => s.traditional);
  const switching = useReaderStore((s) => s.switching);
  const location = useReaderStore((s) => s.location);
  const pagesLeft = useReaderStore((s) => s.pagesLeft);
  const canGoBack = useReaderStore((s) => s.canGoBack);
  const backPage = useReaderStore((s) => s.backPage);
  const bookmarks = useReaderStore((s) => s.bookmarks);
  const bookmarked = useReaderStore((s) => s.bookmarked);

  const settings = useSettings((s) => s.settings);
  const settingsLoaded = useSettings((s) => s.loaded);
  const appearance = settings.appearance;
  const systemDark = useSystemDark();
  const pal = resolvePalette(appearance, systemDark);

  panelOpen.current = panel !== null;

  // 外观、版心的改动即时作用到正文（设置只有一份，在 useSettings 里）
  useEffect(() => {
    if (settingsLoaded) ctrlRef.current?.applySettings(settings);
  }, [settings, settingsLoaded]);

  // 导入的字体增减了：重新注入 @font-face。另外打开阅读器时读一遍字体列表，选的字体被卸载了就退回宋体（M2d）
  const faceCss = useFonts((s) => s.faceCss);
  useEffect(() => {
    ctrlRef.current?.refreshStyles();
  }, [faceCss]);
  useEffect(() => {
    void useFonts.getState().refresh();
  }, []);

  const showChrome = useCallback(() => {
    clearTimeout(hideTimer.current);
    setChrome(true);
  }, []);

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!panelOpen.current) setChrome(false);
    }, HIDE_DELAY_MS);
  }, []);

  const closePanel = useCallback(() => {
    setPanel(null);
    scheduleHide();
  }, [scheduleHide]);

  const togglePanel = useCallback(
    (p: PanelId) => {
      ctrlRef.current?.hideMenu();
      showChrome();
      setPanel((cur) => (cur === p ? null : p));
      scheduleHide();
    },
    [showChrome, scheduleHide],
  );

  const onPointerMove = useCallback(
    ({ x, y }: PointerInfo) => {
      if (y < TOP_ZONE) showChrome();
      else scheduleHide();
      const w = window.innerWidth;
      setEdge(x < EDGE_ZONE ? 'left' : x > w - EDGE_ZONE ? 'right' : null);
    },
    [showChrome, scheduleHide],
  );

  const updateAppearance = useCallback((patch: Partial<Settings['appearance']>) => {
    void useSettings.getState().update((s) => ({ ...s, appearance: { ...s.appearance, ...patch } }));
  }, []);

  const stepFont = useCallback(
    (delta: number | 'reset') => {
      const cur = useSettings.getState().settings.appearance.fontSize;
      // 档位跳法：不在档位上时从最接近的档位继续跳（M2d）
      const next = delta === 'reset' ? 18 : stepFontSize(cur, delta);
      if (next !== cur) updateAppearance({ fontSize: next });
    },
    [updateAppearance],
  );

  const addBooks = useCallback(async () => {
    // 桌面版（Electron/Tauri）返回的是路径，web 版返回 File；不能只留 File，否则桌面版选完没有反应
    const picked = await getPlatform().pickFiles();
    if (picked.length > 0) await useLibrary.getState().importFiles(picked);
  }, []);

  /** 快捷键和 macOS 菜单栏共用的命令执行（DESIGN 第 3 节）；设置在 App 里处理 */
  const runCommand = useCallback(
    (cmd: Command) => {
      const c = ctrlRef.current;
      if (!c) return;
      switch (cmd) {
        case 'toggle-script':
          void c.toggleDisplay();
          break;
        case 'toc':
          togglePanel('toc');
          break;
        case 'search':
          showChrome();
          setPanel('search');
          setSearchFocus((n) => n + 1);
          break;
        case 'bookmark':
          void c.toggleBookmark();
          break;
        case 'bookmarks-panel':
          togglePanel('bookmarks');
          break;
        case 'highlights-panel':
          togglePanel('highlights');
          break;
        case 'close-window':
          getPlatform().window.close();
          break;
        case 'add-books':
          void addBooks();
          break;
        case 'font-bigger':
          stepFont(1);
          break;
        case 'font-smaller':
          stepFont(-1);
          break;
        case 'font-reset':
          stepFont('reset');
          break;
        case 'settings':
          break;
      }
    },
    [togglePanel, showChrome, stepFont, addBooks],
  );

  // macOS 菜单栏点中的命令（App 转进命令总线）
  useEffect(() => onCommand(runCommand), [runCommand]);

  // macOS：工具栏自动隐藏时，红黄绿按钮跟着隐藏（和图书一致）；离开阅读页时恢复
  useEffect(() => {
    if (currentOs() !== 'mac') return;
    const win = getPlatform().window;
    win.setButtonsVisible?.(chrome);
    return () => win.setButtonsVisible?.(true);
  }, [chrome]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const c = ctrlRef.current;
      if (!c) return;
      const k = e.key;
      const typing = isEditable(e.target);

      // 快捷键（Windows 是 Ctrl，mac 是 ⌘）；设置在 App 里。没认出来的 Ctrl/⌘ 组合一律不处理（不翻页、不拦截）
      const cmd = commandOfKey(e);
      if (cmd) {
        if (cmd !== 'settings') {
          e.preventDefault();
          runCommand(cmd);
        }
        return;
      }
      if (hasPrimary(e)) return;
      if (k === 'F11') {
        e.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => {});
        return;
      }
      if (k === 'Escape') {
        // 先关笔记弹窗、选区菜单，再关面板
        if (c.escapeAnnotation()) {
          e.preventDefault();
          return;
        }
        if (panelOpen.current) {
          e.preventDefault();
          closePanel();
        }
        return;
      }
      if (k === 'Alt') {
        e.preventDefault();
        showChrome();
        scheduleHide();
        return;
      }
      if (typing) return;
      if (e.altKey && !e.ctrlKey) {
        if (k === 'ArrowRight') void c.nextSection();
        else if (k === 'ArrowLeft') void c.prevSection();
        else if (k === 'ArrowUp') void c.sectionEdge(false);
        else if (k === 'ArrowDown') void c.sectionEdge(true);
        else return;
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (k) {
        case 'ArrowLeft':
          void c.goLeft();
          break;
        case 'ArrowRight':
          void c.goRight();
          break;
        case 'ArrowUp':
        case 'PageUp':
          void c.prev();
          break;
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
          void c.next();
          break;
        default:
          return;
      }
      e.preventDefault();
    },
    [runCommand, showChrome, scheduleHide, closePanel],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const platform = getPlatform();
    const ctrl = new ReaderController(host, platform, {
      onKeyDown: (e) => onKeyDown(e),
      onPointerMove,
      onPointerDown: () => {
        if (!panelOpen.current) return false;
        closePanel();
        return true;
      },
    });
    ctrlRef.current = ctrl;
    (window as unknown as { __fjd?: unknown }).__fjd = { controller: ctrl };
    void ctrl.open(id);

    const winKey = (e: KeyboardEvent): void => onKeyDown(e);
    const onHide = (): void => void ctrl.flush();
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') void ctrl.flush();
    };
    window.addEventListener('keydown', winKey);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', winKey);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(hideTimer.current);
      ctrl.dispose();
      if (ctrlRef.current === ctrl) ctrlRef.current = null;
      delete (window as unknown as { __fjd?: unknown }).__fjd;
    };
    // 同一本书只建一次；回调是稳定的 useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 点面板外面：关掉面板（页面里的点击由控制器的 onPointerDown 转进来）
  // 也关选区菜单、笔记弹窗；.menu 是要点精选里“…”菜单（挂在 body 上）
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Element | null;
      const st = useReaderStore.getState();
      if (st.menu && !t?.closest?.('[data-sel-menu]')) ctrlRef.current?.hideMenu();
      if (st.noteEditor && !t?.closest?.('[data-note-root], .menu')) ctrlRef.current?.closeNote();
      if (panelOpen.current && !t?.closest?.('[data-panel-root], [data-panel-trigger], .menu')) closePanel();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [closePanel]);

  const ctrl = (): ReaderController | null => ctrlRef.current;
  const isWeb = getPlatform().kind === 'web';
  const ready = status === 'ready';

  return (
    <div
      className="reader"
      data-testid="reader"
      data-status={status}
      data-display={display}
      style={{ ['--page-bg' as string]: pal.bg, ['--page-fg' as string]: pal.fg }}
      onMouseLeave={() => {
        setEdge(null);
        scheduleHide();
      }}
    >
      <div className="reader-host" ref={hostRef} data-testid="reader-host" />

      <div
        className={`toolbar${chrome ? ' visible' : ''}`}
        data-testid="toolbar"
        aria-hidden={!chrome}
        data-tauri-drag-region
        onMouseMove={showChrome}
        onMouseLeave={scheduleHide}
      >
        <div className="tb-left">
          {isWeb && (
            <div className="capsule glass">
              <button className="icon-btn" aria-label="返回书库" title="返回书库" onClick={() => goHash('#/library')}>
                <Books size={18} />
              </button>
            </div>
          )}
          <div className="capsule glass">
            <button
              ref={tocBtn}
              className="icon-btn"
              data-panel-trigger
              data-testid="toc-button"
              aria-label="目录"
              title={withShortcut('目录', 'toc')}
              aria-pressed={panel === 'toc'}
              onClick={() => togglePanel('toc')}
            >
              <ListBullets size={18} />
            </button>
            <button
              ref={bmBtn}
              className="icon-btn"
              data-panel-trigger
              data-testid="bookmarks-button"
              aria-label="书签列表"
              title={withShortcut('书签列表', 'bookmarks-panel')}
              aria-pressed={panel === 'bookmarks'}
              onClick={() => togglePanel('bookmarks')}
            >
              <BookmarksSimple size={18} />
            </button>
            <button
              className="icon-btn"
              data-panel-trigger
              data-testid="highlights-button"
              aria-label="要点精选"
              title={withShortcut('要点精选', 'highlights-panel')}
              aria-pressed={panel === 'highlights'}
              onClick={() => togglePanel('highlights')}
            >
              <Notebook size={18} />
            </button>
          </div>
        </div>

        <div className="title" data-testid="book-title">
          {title}
        </div>

        <div className="tb-right">
          <div className="capsule glass">
            <button
              className="script-btn"
              data-testid="script-toggle"
              disabled={!traditional || switching || !ready}
              aria-label={display === 'converted' ? '显示原文' : '显示简体'}
              title={!traditional ? '这本书本身就是简体' : withShortcut(display === 'converted' ? '显示原文' : '显示简体', 'toggle-script')}
              onClick={() => void ctrl()?.toggleDisplay()}
            >
              {display === 'converted' ? '简' : '繁'}
            </button>
            <button
              ref={sizeBtn}
              className="icon-btn size-btn"
              data-panel-trigger
              data-testid="appearance-button"
              aria-label="主题与设置"
              title="主题与设置"
              aria-pressed={panel === 'appearance'}
              onClick={() => togglePanel('appearance')}
            >
              <span className="size-glyph" aria-hidden>
                <span className="big">大</span>
                <span className="small">小</span>
              </span>
            </button>
            <button
              ref={searchBtn}
              className="icon-btn"
              data-panel-trigger
              data-testid="search-button"
              aria-label="搜索"
              title={withShortcut('在书中搜索', 'search')}
              aria-pressed={panel === 'search'}
              onClick={() => {
                if (panel === 'search') closePanel();
                else {
                  showChrome();
                  setPanel('search');
                  setSearchFocus((n) => n + 1);
                }
              }}
            >
              <MagnifyingGlass size={18} />
            </button>
          </div>
          <button
            className="icon-btn glass bookmark-btn"
            data-testid="bookmark-button"
            aria-label={bookmarked ? '删除书签' : '添加书签'}
            aria-pressed={bookmarked}
            title={withShortcut(bookmarked ? '删除书签' : '添加书签', 'bookmark')}
            disabled={!ready}
            onClick={() => void ctrl()?.toggleBookmark()}
          >
            <BookmarkSimple size={18} weight={bookmarked ? 'fill' : 'regular'} />
          </button>
          <WindowControls />
        </div>
      </div>

      {panel === 'toc' && (
        <TocPanel
          anchor={tocBtn.current}
          toc={toc}
          currentHref={currentHref}
          onPick={(href) => {
            closePanel();
            void ctrl()?.goToHref(href);
          }}
        />
      )}
      {panel === 'bookmarks' && (
        <BookmarkPanel
          anchor={bmBtn.current}
          bookmarks={bookmarks}
          onPick={(b) => {
            closePanel();
            void ctrl()?.goToCfi(b.cfi);
          }}
          onRemove={(b) => ctrl()?.removeBookmark(b.id)}
        />
      )}
      {panel === 'search' && (
        <SearchPanel
          anchor={searchBtn.current}
          ctrl={ctrl()}
          focusKey={searchFocus}
          onPick={(cfi) => {
            closePanel();
            void ctrl()?.goToCfi(cfi, true);
          }}
        />
      )}
      {panel === 'highlights' && (
        <HighlightsPanel
          ctrl={ctrl()}
          onPick={(h) => {
            closePanel();
            void ctrl()?.goToHighlight(h.id);
          }}
        />
      )}
      {panel === 'appearance' && <AppearancePanel anchor={sizeBtn.current} appearance={appearance} onChange={updateAppearance} />}

      <SelectionMenu ctrl={ctrl()} />
      <NotePopover ctrl={ctrl()} />

      <button
        className={`edge-arrow left glass${edge === 'left' ? ' visible' : ''}`}
        aria-label="上一页"
        tabIndex={edge === 'left' ? 0 : -1}
        onClick={() => void ctrl()?.goLeft()}
      >
        <CaretLeft size={18} weight="bold" />
      </button>
      <button
        className={`edge-arrow right glass${edge === 'right' ? ' visible' : ''}`}
        aria-label="下一页"
        tabIndex={edge === 'right' ? 0 : -1}
        onClick={() => void ctrl()?.goRight()}
      >
        <CaretRight size={18} weight="bold" />
      </button>

      <div className="footer" data-testid="footer">
        <div className="left">
          {canGoBack && (
            <button className="back-btn glass" aria-label="返回" title={backPage ? `返回第 ${backPage} 页` : '返回'} data-testid="back-button" onClick={() => ctrl()?.goBack()}>
              <ArrowUUpLeft size={12} weight="bold" />
              {backPage ? <span className="n">{backPage}</span> : null}
            </button>
          )}
        </div>
        <div className="center" data-testid="page-position">
          {location ? `${location.current} / ${location.total}` : ''}
        </div>
        <div className="right" data-testid="pages-left">
          {pagesLeft !== null ? `本章还剩 ${pagesLeft} 页` : ''}
        </div>
      </div>

      {(status === 'loading' || switching) && (
        <div className="reader-status" data-testid="reader-loading" role="status">
          {switching ? '正在切换…' : '正在打开…'}
        </div>
      )}
      {status === 'error' && (
        <div className="reader-status error" data-testid="reader-error" role="alert">
          <div>打不开这本书</div>
          <div style={{ color: 'var(--c-label-2)' }}>{error}</div>
          <button className="btn" onClick={() => goHash('#/library')}>
            返回书库
          </button>
        </div>
      )}
    </div>
  );
}

function goHash(h: string): void {
  window.location.hash = h;
}
