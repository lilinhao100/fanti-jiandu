// 阅读器控制器：把 foliate、引擎和平台串起来。React 组件只负责界面，所有“打开一本书”的逻辑在这里。
// 设计依据：docs/ARCHITECTURE.md 3.5；foliate 钩子的结论见 docs/notes/foliate-hooks.md。
import { convertText, type ConvertOptions } from '@fjd/engine';
import { Overlayer } from 'foliate-js/overlayer.js';
import { makeBook } from 'foliate-js/view.js';
import type { BookAnnotations, BookProgress, BookRecord, Bookmark, Highlight, Settings } from '../model';
import type { Platform } from '../platform';
import { useReaderStore, type Box } from '../store/reader';
import { useFonts } from '../store/fonts';
import { useSettings } from '../store/settings';
import { pageBookmarks, snippetOf } from './bookmarks';
import type { FoliateBook, FoliateView, RelocateDetail, TocItem } from './foliateTypes';
import { HighlightLayer } from './highlightLayer';
import { isDarkBackground } from './highlightPaint';
import { computeLayout } from './layout';
import { cleanTitle, pickTitle } from './meta';
import { displayMode, effectiveOptions, isTraditional, textOptions } from './options';
import { buildReaderStyles, resolvePalette } from './styles';
import { convertToc, stripHanSpaces } from './toc';
import {
  detectBook,
  hookDataEvent,
  isCjkLanguage,
  kindOf,
  onSectionLoaded,
  wrapCreateDocument,
  type TransformState,
} from './transforms';

export interface PointerInfo {
  /** 相对阅读窗口（视口）的坐标 */
  x: number;
  y: number;
}

export interface ControllerHooks {
  onKeyDown(e: KeyboardEvent): void;
  onPointerMove(p: PointerInfo): void;
  /** 在页面里按下鼠标。返回 true 表示关掉了一个弹出面板，随后的这次点击不翻页 */
  onPointerDown?(): boolean;
}

interface RestoreTarget {
  cfi?: string | null;
  fraction?: number | null;
}

/** 翻页后多久把阅读进度写盘（规格：debounce 1 秒） */
export const PROGRESS_DEBOUNCE_MS = 1000;
/** 两种模式下 CFI 落点差超过全书的这个比例，就改用 fraction 兜底 */
const FRACTION_FALLBACK_DELTA = 0.01;

export interface SearchHit {
  label: string;
  cfi: string;
  excerpt: { pre: string; match: string; post: string };
}

/** 点搜索结果跳过去之后，在页面上闪烁高亮的时长（DESIGN 2.9） */
export const FLASH_MS = 1200;
const FLASH_COLOR = '#FFDC00';
/** 搜索结果最多取这么多条，免得常见词把面板撑爆 */
export const SEARCH_LIMIT = 300;

export class ReaderController {
  private view: FoliateView | null = null;
  private book: FoliateBook | null = null;
  private file: File | null = null;
  private record!: BookRecord;
  private settings!: Settings;
  private transform: TransformState | null = null;
  private disposed = false;
  private mountSeq = 0;
  private restoring = false;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private pending: BookProgress | null = null;
  private saving: Promise<void> = Promise.resolve();
  private teardowns: (() => void)[] = [];
  private lastTurnAt = 0;
  private resizeObserver: ResizeObserver | null = null;
  private layoutKey = '';
  private layoutFrame = 0;
  private stylesKey = '';
  private annotations: BookAnnotations = { bookmarks: [], highlights: [] };
  private annotationSaving: Promise<void> = Promise.resolve();
  /** 跳转前的页码栈，和 foliate 的 history 一一对应（“返回”按钮上的数字） */
  private backPages: number[] = [];
  private prevPageNo: number | undefined;
  private backing = false;
  private swallowClick = false;
  private searchSeq = 0;
  private flashValue: string | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  /** 章节序号 → 所在章节的标题（已按当前显示模式转换）；要点精选分组用 */
  private chapterLabels: string[] = [];
  private currentMode: 'converted' | 'original' = 'converted';
  /** 高亮层：创建、画、重新定位（M2c） */
  private readonly layer = new HighlightLayer({
    view: () => this.view,
    book: () => this.book,
    display: () => (this.transform ? { mode: this.currentMode, opts: this.transform.opts } : null),
    darkPage: () => {
      const pal = resolvePalette(this.settings.appearance, matchMedia('(prefers-color-scheme: dark)').matches);
      return pal.dark || isDarkBackground(pal.bg);
    },
    list: () => this.annotations.highlights,
    commit: (next) => this.setHighlights(next),
    chapterOf: (i) => this.chapterLabels[i] ?? '',
  });

  constructor(
    private readonly host: HTMLElement,
    private readonly platform: Platform,
    private readonly hooks: ControllerHooks,
  ) {}

  /** 给测试和调试用 */
  get debug(): { view: FoliateView | null; book: FoliateBook | null; options: ConvertOptions | null } {
    return { view: this.view, book: this.book, options: this.transform?.opts ?? null };
  }

  /** 给测试用：每条高亮现在画在哪（页面上的文字、章内偏移、是否定位上） */
  highlightDebug(): ReturnType<HighlightLayer['debug']> {
    return this.layer.debug();
  }

  async open(id: string): Promise<void> {
    const store = useReaderStore.getState();
    store.reset();
    store.set({ status: 'loading', bookId: id });
    try {
      const books = await this.platform.listBooks();
      const rec = books.find((b) => b.id === id);
      if (!rec) throw new Error('书库里没有这本书');
      this.record = rec;
      // 设置只有一份：useSettings（App 启动时已经在读，这里等它读完）
      const st = useSettings.getState();
      this.settings = st.loaded ? st.settings : await st.load();
      // 导入字体的 @font-face 要在第一次注入样式之前就绪，否则先闪一下备用字体
      await useFonts.getState().ensureFaces();
      this.annotations = await this.platform.loadAnnotations(id);
      this.file = await this.platform.readBookFile(id);
      if (this.disposed) return;
      await this.mount({ cfi: rec.progress?.cfi, fraction: rec.progress?.fraction });
      if (this.disposed) return;
      const now = Date.now();
      this.record = { ...this.record, lastOpenedAt: now };
      void this.platform.updateBook(id, { lastOpenedAt: now });
    } catch (e) {
      console.error(e);
      if (this.disposed) return;
      useReaderStore.getState().set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ------------------------------------------------------------------ 打开 / 重开

  private async mount(restore: RestoreTarget | null, modeOverride?: 'converted' | 'original'): Promise<void> {
    const seq = ++this.mountSeq;
    const store = useReaderStore.getState();
    const file = this.file!;
    const book = await makeBook(file);
    if (this.disposed || seq !== this.mountSeq) {
      book.destroy?.();
      return;
    }

    // 首次打开：检测繁/简与 PDF 转制，结果缓存进 BookRecord（必须在包装 createDocument 之前）
    if (!this.record.script || this.record.pdfReflow === undefined) {
      const d = await detectBook(book);
      this.record = { ...this.record, script: d.script, pdfReflow: d.pdfReflow };
      await this.platform.updateBook(this.record.id, { script: d.script, pdfReflow: d.pdfReflow });
    }

    const mode = modeOverride ?? displayMode(this.record);
    const conv = this.settings.conversion;
    const opts = effectiveOptions(this.record, conv, mode);
    const state: TransformState = {
      kind: kindOf(book),
      opts,
      ctx: { pdfReflow: !!this.record.pdfReflow },
      cjk: isCjkLanguage(book, this.record.script),
    };
    // 竖排转横排：翻页方向也要随之改成从左往右（笔记第 4 节）
    if (opts.horizontal && state.cjk && book.dir === 'rtl') book.dir = 'ltr';
    wrapCreateDocument(book, state);
    hookDataEvent(book, state);

    // 书名与目录：用文字转换（不含排版），目录拷贝一份再转，因为 foliate 会就地给 toc 加 id
    const tOpts = textOptions({ script: this.record.script, display: mode }, conv);
    const title = convertText(cleanTitle(pickTitle(book.metadata?.title) || this.record.title), tOpts);
    // PDF 转制书的目录标签也带着换行留下的空格，清理开关开着时一并去掉
    const toc = convertToc(book.toc, { text: tOpts, stripSpaces: !!this.record.pdfReflow && opts.cleanup });

    this.book = book;
    this.transform = state;
    this.currentMode = mode;

    const view = document.createElement('foliate-view') as FoliateView;
    view.style.cssText = 'display:block;position:absolute;inset:0;';
    this.host.append(view);
    this.view = view;
    this.bindView(view);

    await view.open(book);
    if (this.disposed || seq !== this.mountSeq) return;

    this.applyLayout(true);
    // 让 paginator 里 ResizeObserver 的首次回调先落地（此时还没有章节视图，是空操作）。
    // 否则它可能恰好落在第一章的 iframe 加载到一半时，paginator 会对还没有 body 的文档调用 render（上游的竞态）。
    await nextFrames(2);
    if (this.disposed || seq !== this.mountSeq) return;
    this.applyStyles(true);

    store.set({
      title,
      toc,
      traditional: isTraditional(this.record.script),
      display: mode,
      currentHref: undefined,
      bookmarks: this.annotations.bookmarks,
      bookmarked: false,
      highlights: this.annotations.highlights,
    });

    this.restoring = true;
    try {
      await this.restorePosition(restore);
    } finally {
      this.restoring = false;
    }
    if (this.disposed || seq !== this.mountSeq) return;
    this.platform.window.setTitle(title);
    store.set({ status: 'ready' });
    // 高亮重新定位：章节标题（分组用）、每条高亮在不在、在哪（要点精选面板用）
    void this.computeChapterLabels(book).then(() => {
      if (this.disposed || seq !== this.mountSeq) return;
      void this.layer.resolveAll();
    });
  }

  private async computeChapterLabels(book: FoliateBook): Promise<void> {
    const labels: string[] = new Array(book.sections.length).fill('');
    const b = book as FoliateBook & { splitTOCHref?: (href: string) => unknown[] | Promise<unknown[]> };
    if (typeof b.splitTOCHref === 'function') {
      const flat: TocItem[] = [];
      const walk = (items?: TocItem[] | null): void => {
        for (const it of items ?? []) {
          flat.push(it);
          walk(it.subitems);
        }
      };
      walk(book.toc);
      const byId = new Map<unknown, string>();
      for (const it of flat) {
        try {
          const [id] = (await b.splitTOCHref(it.href)) ?? [];
          if (id !== undefined && !byId.has(id)) byId.set(id, this.convertLabel(it.label ?? ''));
        } catch {
          // 这一项的链接解析不了：跳过
        }
      }
      let prev = '';
      book.sections.forEach((sec, i) => {
        const l = byId.get(sec.id);
        if (l) prev = l;
        labels[i] = prev;
      });
    }
    this.chapterLabels = labels;
  }

  private async restorePosition(r: RestoreTarget | null): Promise<void> {
    const view = this.view!;
    const hasCfi = !!r?.cfi;
    try {
      await view.init({ lastLocation: hasCfi ? r!.cfi : null, showTextStart: true });
    } catch (e) {
      console.warn('按 CFI 恢复位置失败，改用 fraction', e);
      try {
        if (typeof r?.fraction === 'number') await view.goToFraction(r.fraction);
        else await view.init({ showTextStart: true });
      } catch (e2) {
        console.warn(e2);
      }
      return;
    }
    // CFI 在繁/简两种模式下结构可能不同（排版清理会合并段落）：落点偏离太多就用 fraction 兜底
    if (hasCfi && typeof r?.fraction === 'number') {
      const got = view.lastLocation?.fraction;
      if (typeof got === 'number' && Math.abs(got - r.fraction) > FRACTION_FALLBACK_DELTA) {
        try {
          await view.goToFraction(r.fraction);
        } catch (e) {
          console.warn(e);
        }
      }
    }
  }

  private teardownView(): void {
    for (const f of this.teardowns.splice(0)) f();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    cancelAnimationFrame(this.layoutFrame);
    clearTimeout(this.flashTimer);
    this.flashValue = null;
    this.searchSeq++;
    this.layoutKey = '';
    this.stylesKey = '';
    this.backPages = [];
    this.prevPageNo = undefined;
    this.backing = false;
    this.layer.reset();
    this.chapterLabels = [];
    useReaderStore.getState().set({ backPage: null, canGoBack: false });
    try {
      this.view?.close();
    } catch (e) {
      console.warn(e);
    }
    this.view?.remove();
    this.view = null;
    // view.close() 不会销毁 book（笔记第 10 节）；blob URL 要自己回收
    try {
      this.book?.destroy?.();
    } catch (e) {
      console.warn(e);
    }
    this.book = null;
  }

  // ------------------------------------------------------------------ 事件

  private bindView(view: FoliateView): void {
    const onRelocate = (e: Event): void => {
      const d = (e as CustomEvent<RelocateDetail>).detail;
      const r = view.renderer;
      const pages = r.pages;
      const page = r.page;
      const st = useReaderStore.getState();
      this.prevPageNo = st.location?.current;
      st.set({
        location: d.location ? { current: d.location.current + 1, total: d.location.total } : null,
        pagesLeft: pages > 2 ? Math.max(0, pages - 2 - page) : null,
        fraction: d.fraction ?? 0,
        currentHref: d.tocItem?.href ?? undefined,
        bookmarked: !!d.cfi && pageBookmarks(this.annotations.bookmarks, d.cfi).length > 0,
      });
      if (!this.restoring) this.layer.onRelocate();
      if (d.cfi && !this.restoring) this.scheduleSave({ cfi: d.cfi, fraction: d.fraction ?? 0, updatedAt: Date.now() });
    };
    const onLoad = (e: Event): void => {
      const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail;
      if (this.transform) onSectionLoaded(doc, this.transform);
      this.attachDocInputs(doc, index);
    };
    // 章节的覆盖层建好了：把这一章的高亮画上去。事件发在 attach 之前，等一个微任务（overlayer 和 view 此时才挂好）
    const onOverlay = (e: Event): void => {
      const { index } = (e as CustomEvent<{ index: number }>).detail;
      queueMicrotask(() => {
        if (this.view === view) this.layer.drawSection(index);
      });
    };
    const onShow = (e: Event): void => this.layer.onShowAnnotation((e as CustomEvent<{ value: string }>).detail.value);
    // foliate 的 goTo 是“先翻到目标页（relocate），再 pushState”，所以这时 prevPageNo 正是跳转前的页码
    const onHistory = (): void => {
      if (this.backing) this.backPages.pop();
      else if (view.history.canGoBack) this.backPages.push(this.prevPageNo ?? 0);
      if (!view.history.canGoBack) this.backPages = [];
      useReaderStore.getState().set({ canGoBack: view.history.canGoBack, backPage: this.backPages.at(-1) || null });
    };
    // 标注层：目前只负责搜索跳转后的闪烁高亮；M2c 的高亮在这里加自己的分支
    const onDraw = (e: Event): void => {
      const { draw, annotation } = (e as CustomEvent<{ draw: (f: unknown, o?: unknown) => void; annotation: { value: string } }>).detail;
      if (annotation.value !== this.flashValue) return;
      const dark = resolvePalette(this.settings.appearance, matchMedia('(prefers-color-scheme: dark)').matches).dark;
      const peak = dark ? 0.45 : 0.6;
      draw(
        (rects: Iterable<DOMRect>, o: { color: string }) => {
          const g = Overlayer.highlight(rects, o);
          g.style.opacity = String(peak);
          g.style.mixBlendMode = dark ? 'normal' : 'multiply';
          g.animate?.([{ opacity: 0 }, { opacity: peak, offset: 0.12 }, { opacity: peak, offset: 0.7 }, { opacity: 0 }], {
            duration: FLASH_MS,
            fill: 'forwards',
          });
          return g;
        },
        { color: FLASH_COLOR },
      );
    };
    view.addEventListener('relocate', onRelocate);
    view.addEventListener('load', onLoad);
    view.addEventListener('draw-annotation', onDraw);
    view.addEventListener('create-overlay', onOverlay);
    view.addEventListener('show-annotation', onShow);
    view.history.addEventListener('index-change', onHistory);

    // 窗口大小变化时重算版心（单页/双页、外边距都跟窗口宽度成比例）。合并到下一帧，免得拖动窗口时连续重排
    this.resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(this.layoutFrame);
      this.layoutFrame = requestAnimationFrame(() => this.applyLayout(false));
    });
    this.resizeObserver.observe(this.host);
    // 页面模式为“自动”时，系统深浅色变了，正文配色也要跟着变
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = (): void => {
      this.applyStyles(true);
      this.layer.redrawAll();
    };
    mq.addEventListener('change', onScheme);
    this.teardowns.push(() => mq.removeEventListener('change', onScheme));

    // 宿主页面上的滚轮（页边空白处）
    const onWheel = (e: WheelEvent): void => this.handleWheel(e);
    const onMove = (e: MouseEvent): void => this.hooks.onPointerMove({ x: e.clientX, y: e.clientY });
    const onDown = (): void => void this.hooks.onPointerDown?.();
    this.host.addEventListener('wheel', onWheel, { passive: true });
    this.host.addEventListener('mousemove', onMove);
    this.host.addEventListener('pointerdown', onDown);
    this.teardowns.push(() => {
      this.host.removeEventListener('wheel', onWheel);
      this.host.removeEventListener('mousemove', onMove);
      this.host.removeEventListener('pointerdown', onDown);
    });
  }

  /** 版心：单页/双页、外边距、中缝、上下边距（layout.ts 把 DESIGN 2.1 换算成分页器的属性） */
  private applyLayout(force: boolean): void {
    const view = this.view;
    const r = view?.renderer;
    if (!view || !r) return;
    const { margin, columns } = this.settings.appearance;
    const layout = computeLayout(this.host.clientWidth, this.host.clientHeight, margin, columns);
    if (useReaderStore.getState().twoColumns !== layout.two) useReaderStore.getState().set({ twoColumns: layout.two });
    const animated = this.settings.reading.animated && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const key = JSON.stringify([layout, animated]);
    if (!force && key === this.layoutKey) return;
    this.layoutKey = key;
    view.style.inset = `${layout.inset.top}px ${layout.inset.right}px 0 ${layout.inset.left}px`;
    for (const [k, v] of Object.entries(layout.attrs)) r.setAttribute(k, v);
    // 翻页动画：设置里的开关，并尊重系统的“减少动画”
    if (animated) r.setAttribute('animated', '');
    else r.removeAttribute('animated');
    // gap、margin 只改 CSS 变量，不会自己重排；max-inline-size 会，这里统一再排一次
    (r as unknown as { render?: () => void }).render?.();
  }

  /** 正文样式：setStyles 之后分页器按“上次可见的 Range”保持位置（笔记第 5 节） */
  private applyStyles(force: boolean): void {
    const r = this.view?.renderer;
    if (!r || !this.transform) return;
    const [before, after] = buildReaderStyles({
      appearance: this.settings.appearance,
      horizontal: this.transform.opts.horizontal,
      systemDark: matchMedia('(prefers-color-scheme: dark)').matches,
      fontFaceCss: useFonts.getState().faceCss,
    });
    const key = before + after;
    if (!force && key === this.stylesKey) return;
    this.stylesKey = key;
    r.setStyles([before, after]);
  }

  /** 导入的字体增减了：@font-face 规则变了，重新注入样式（位置不动） */
  refreshStyles(): void {
    if (this.view && this.settings) this.applyStyles(false);
  }

  /** 设置变了（外观面板、设置窗口）：即时作用到正文和版心，不重开书、不动位置 */
  applySettings(next: Settings): void {
    if (!this.settings || next === this.settings) return;
    const prev = this.settings;
    this.settings = next;
    if (!this.view) return;
    // 转换选项（词汇、引号、清理、竖排转横排）改在文字层，要重新打开这本书才生效
    if (JSON.stringify(prev.conversion) !== JSON.stringify(next.conversion)) {
      void this.reopen();
      return;
    }
    this.applyStyles(false);
    this.applyLayout(false);
    // 高亮的叠加方式随页面深浅变（DESIGN 2.8）
    if (prev.appearance.theme !== next.appearance.theme || prev.appearance.mode !== next.appearance.mode) this.layer.redrawAll();
  }

  /** iframe 里的文档收不到宿主的事件，要单独绑定（笔记第 10 节） */
  private attachDocInputs(doc: Document, index: number): void {
    const frame = doc.defaultView?.frameElement as HTMLElement | null;
    const toHost = (x: number, y: number): PointerInfo => {
      const fr = frame?.getBoundingClientRect();
      return { x: (fr?.left ?? 0) + x, y: (fr?.top ?? 0) + y };
    };
    doc.addEventListener('keydown', (e) => this.hooks.onKeyDown(e));
    doc.addEventListener('wheel', (e) => this.handleWheel(e), { passive: true });
    doc.addEventListener('mousemove', (e) => this.hooks.onPointerMove(toHost(e.clientX, e.clientY)));
    doc.addEventListener('pointerdown', () => {
      // 选区菜单、笔记弹窗开着时，点页面只是把它们关掉，不翻页
      const dismissed = this.layer.dismiss();
      this.swallowClick = (this.hooks.onPointerDown?.() ?? false) || dismissed;
    });
    // 选完字（鼠标抬起、Shift+方向键）弹出选区菜单；晚一拍等浏览器把选区定下来
    doc.addEventListener('mouseup', () => setTimeout(() => this.layer.checkSelection(doc, index), 0));
    doc.addEventListener('keyup', (e) => {
      if (e.shiftKey || e.key === 'Shift') setTimeout(() => this.layer.checkSelection(doc, index), 0);
    });
    doc.addEventListener('click', (e) => {
      // 有弹出面板开着时，点页面只是关掉面板，不翻页
      if (this.swallowClick) {
        this.swallowClick = false;
        return;
      }
      // 链接点击已被 foliate 接管并 preventDefault（view.js:353-356）
      if (e.defaultPrevented) return;
      const target = e.target as Element | null;
      if (target?.closest?.('a[href], button, input, select, textarea, [role="button"]')) return;
      const sel = doc.getSelection();
      if (sel && sel.type === 'Range') return; // 正在选字，不翻页
      // 点在高亮上（foliate 会发 show-annotation，弹出菜单）或便签图标上：不翻页
      const hit = this.layer.hitAt(doc, e.clientX, e.clientY);
      if (hit) {
        if (hit.kind === 'note') this.layer.openNote(hit.id);
        return;
      }
      this.turnByPosition(toHost(e.clientX, e.clientY).x);
    });
  }

  /** 点击左右三分之一翻页（DESIGN 2.4） */
  private turnByPosition(hostX: number): void {
    const view = this.view;
    if (!view) return;
    const rect = view.getBoundingClientRect();
    if (rect.width <= 0) return;
    const rel = (hostX - rect.left) / rect.width;
    if (rel < 1 / 3) void this.goLeft();
    else if (rel > 2 / 3) void this.goRight();
  }

  private handleWheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey) return;
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(d) < 4) return;
    const now = performance.now();
    if (now - this.lastTurnAt < 350) return;
    this.lastTurnAt = now;
    if (d > 0) void this.next();
    else void this.prev();
  }

  // ------------------------------------------------------------------ 导航

  next = async (): Promise<void> => {
    try {
      await this.view?.next();
    } catch (e) {
      console.warn(e);
    }
  };
  prev = async (): Promise<void> => {
    try {
      await this.view?.prev();
    } catch (e) {
      console.warn(e);
    }
  };
  goLeft = async (): Promise<void> => {
    try {
      await this.view?.goLeft();
    } catch (e) {
      console.warn(e);
    }
  };
  goRight = async (): Promise<void> => {
    try {
      await this.view?.goRight();
    } catch (e) {
      console.warn(e);
    }
  };
  nextSection = async (): Promise<void> => {
    await this.view?.renderer.nextSection();
  };
  prevSection = async (): Promise<void> => {
    await this.view?.renderer.prevSection();
  };
  goToHref = async (href: string): Promise<void> => {
    await this.view?.goTo(href);
  };
  goBack = (): void => {
    this.backing = true;
    try {
      this.view?.history.back();
    } finally {
      this.backing = false;
    }
  };
  /** Alt+↑ / Alt+↓：回到本章开头、去到本章末尾 */
  sectionEdge = async (end: boolean): Promise<void> => {
    const r = this.view?.renderer;
    const index = r?.getContents()[0]?.index;
    if (!r || index == null) return;
    try {
      await r.goTo({ index, anchor: end ? () => 1 : () => 0 });
    } catch (e) {
      console.warn(e);
    }
  };

  /** 跳到某个 CFI（书签、搜索结果）；flash 为真时在目标处闪烁高亮 1.2 秒 */
  goToCfi = async (cfi: string, flash = false): Promise<void> => {
    const view = this.view;
    if (!view) return;
    await view.goTo(cfi);
    if (flash) await this.flash(cfi);
  };

  private async flash(cfi: string): Promise<void> {
    const view = this.view;
    if (!view) return;
    clearTimeout(this.flashTimer);
    if (this.flashValue) void view.deleteAnnotation({ value: this.flashValue });
    this.flashValue = cfi;
    try {
      await view.addAnnotation({ value: cfi });
    } catch (e) {
      console.warn(e);
    }
    this.flashTimer = setTimeout(() => {
      void view.deleteAnnotation({ value: cfi });
      if (this.flashValue === cfi) this.flashValue = null;
    }, FLASH_MS);
  }

  // ------------------------------------------------------------------ 书签

  /** 当前页的书签 */
  currentPageBookmarks(): Bookmark[] {
    const cfi = this.view?.lastLocation?.cfi;
    return cfi ? pageBookmarks(this.annotations.bookmarks, cfi) : [];
  }

  /** Ctrl+D / 书签按钮：当前页有书签就删掉，没有就加一个 */
  toggleBookmark = async (): Promise<void> => {
    const loc = this.view?.lastLocation;
    if (!loc?.cfi || useReaderStore.getState().status !== 'ready') return;
    const here = this.currentPageBookmarks();
    if (here.length > 0) {
      const ids = new Set(here.map((b) => b.id));
      this.setBookmarks(this.annotations.bookmarks.filter((b) => !ids.has(b.id)));
      return;
    }
    const chapterRaw = loc.tocItem?.label ?? '';
    const chapter = this.convertLabel(chapterRaw);
    const bm: Bookmark = {
      id: `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      cfi: loc.cfi,
      label: snippetOf(loc.range) || chapter || `第 ${useReaderStore.getState().location?.current ?? ''} 页`,
      createdAt: Date.now(),
      ...(chapter ? { chapter } : {}),
    };
    this.setBookmarks([...this.annotations.bookmarks, bm]);
  };

  removeBookmark = (id: string): void => {
    this.setBookmarks(this.annotations.bookmarks.filter((b) => b.id !== id));
  };

  private setBookmarks(list: Bookmark[]): void {
    this.annotations = { ...this.annotations, bookmarks: list };
    const cfi = this.view?.lastLocation?.cfi;
    useReaderStore.getState().set({ bookmarks: list, bookmarked: !!cfi && pageBookmarks(list, cfi).length > 0 });
    this.saveAnnotations();
  }

  // ------------------------------------------------------------------ 高亮与笔记（M2c，逻辑在 highlightLayer.ts）

  private setHighlights(list: Highlight[]): void {
    this.annotations = { ...this.annotations, highlights: list };
    useReaderStore.getState().set({ highlights: list });
    this.saveAnnotations();
  }

  /** 选区菜单：颜色或下划线 */
  applyHighlightStyle = (style: Highlight['style']): void => void this.layer.applyStyle(style);
  /** 选区菜单：笔记 */
  startNote = (): void => this.layer.startNote();
  /** 选区菜单：拷贝 */
  copySelection = (): Promise<string> => this.layer.copy();
  removeHighlight = (id: string): void => this.layer.remove(id);
  setHighlightNote = (id: string, note: string): void => this.layer.setNote(id, note);
  /** 要点精选里编辑笔记：弹窗放在 rect（面板里这一条）的右边 */
  editNote = (id: string, rect?: Box): void => this.layer.openNote(id, rect, rect ? 'panel' : 'page');
  closeNote = (): void => this.layer.closeNote();
  hideMenu = (): void => this.layer.hideMenu();
  /** Esc：关笔记弹窗或选区菜单。返回是否处理了 */
  escapeAnnotation = (): boolean => this.layer.escape();
  goToHighlight = (id: string): Promise<boolean> => this.layer.goTo(id);

  /** 写盘（串行，后一次覆盖前一次）。书签、高亮都走这里 */
  private saveAnnotations(): void {
    const id = this.record.id;
    const snapshot = this.annotations;
    this.annotationSaving = this.annotationSaving
      .then(() => this.platform.saveAnnotations(id, snapshot))
      .catch((e) => console.warn('保存书签失败', e));
  }

  /** 章节名、目录标签：转成当前显示的字形，PDF 转制书再去掉换行留下的空格 */
  private convertLabel(label: string): string {
    const t = label.trim();
    if (!t) return '';
    const text = convertText(t, this.transform?.opts ?? textOptions(this.record, this.settings.conversion));
    return this.record.pdfReflow && this.transform?.opts.cleanup ? stripHanSpaces(text) : text;
  }

  /** 书内搜索：查询词先转成当前显示的字形，搜的是转换后的文本（笔记第 3 节）。一次返回全部 */
  async search(query: string, limit = 200): Promise<SearchHit[]> {
    const hits: SearchHit[] = [];
    await this.searchStream(query, (batch) => hits.push(...batch), limit, false);
    return hits;
  }

  /**
   * 流式搜索：每搜完一章就把这一章的命中交给 onBatch（界面按章节分组显示）。
   * 新的搜索开始、清除搜索或关闭面板会让正在进行的搜索停下。page 为真时，当前页上的命中会用蓝色描边标出来。
   * 返回是否因为超过 limit 而截断。
   */
  async searchStream(query: string, onBatch: (hits: SearchHit[]) => void, limit = SEARCH_LIMIT, mark = true): Promise<boolean> {
    const view = this.view;
    const seq = ++this.searchSeq;
    if (!view || !query.trim()) {
      this.clearSearch();
      return false;
    }
    const q = convertText(query.trim(), this.transform?.opts ?? textOptions(this.record, this.settings.conversion));
    let count = 0;
    let truncated = false;
    const iter = view.search({
      query: q,
      draw: mark ? Overlayer.outline : () => document.createElementNS('http://www.w3.org/2000/svg', 'g'),
      drawOptions: { color: '#0088FF', width: 2, radius: 3 },
    });
    try {
      for await (const r of iter) {
        if (seq !== this.searchSeq) break;
        const item = r as { label?: string; subitems?: { cfi: string; excerpt: SearchHit['excerpt'] }[] };
        if (!item.subitems) continue;
        const label = this.convertLabel(item.label ?? '');
        const room = limit - count;
        const batch = item.subitems.slice(0, room).map((s) => ({ label, cfi: s.cfi, excerpt: s.excerpt }));
        count += batch.length;
        if (batch.length) onBatch(batch);
        if (item.subitems.length > room || count >= limit) {
          truncated = item.subitems.length > room;
          break;
        }
      }
    } finally {
      if (!mark && seq === this.searchSeq) view.clearSearch();
    }
    return truncated;
  }

  /** 停掉正在进行的搜索，并去掉页面上的命中标记 */
  clearSearch(): void {
    this.searchSeq++;
    try {
      this.view?.clearSearch();
    } catch (e) {
      console.warn(e);
    }
  }

  // ------------------------------------------------------------------ 繁/简

  /** 切换繁/简：记下位置，换选项，重新打开，再跳回原位（ARCHITECTURE 3.5） */
  async toggleDisplay(): Promise<void> {
    const store = useReaderStore.getState();
    if (store.switching || store.status !== 'ready' || !isTraditional(this.record.script)) return;
    await this.reopen(store.display === 'converted' ? 'original' : 'converted');
  }

  /** 重新打开当前这本书并回到原位。display 给了就同时切换繁/简；不给就是设置里的转换选项变了 */
  private async reopen(display?: 'converted' | 'original'): Promise<void> {
    const store = useReaderStore.getState();
    if (store.switching || store.status !== 'ready') return;
    const mode = display ?? store.display;
    const loc = this.view?.lastLocation;
    const restore: RestoreTarget = { cfi: loc?.cfi, fraction: loc?.fraction };
    store.set({ switching: true });
    try {
      this.cancelSave();
      if (display) {
        this.record = { ...this.record, display };
        await this.platform.updateBook(this.record.id, { display });
      }
      this.teardownView();
      await this.mount(restore, mode);
    } catch (e) {
      console.error(e);
      useReaderStore.getState().set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    } finally {
      useReaderStore.getState().set({ switching: false });
    }
  }

  // ------------------------------------------------------------------ 进度保存

  private scheduleSave(p: BookProgress): void {
    this.pending = p;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), PROGRESS_DEBOUNCE_MS);
  }

  private cancelSave(): void {
    clearTimeout(this.saveTimer);
    this.pending = null;
  }

  /** 立刻写盘（关闭阅读器、页面隐藏时调用）。多次写入串行，保证后一次覆盖前一次 */
  flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    const p = this.pending;
    this.pending = null;
    if (!p || !this.record) return this.saving;
    this.record = { ...this.record, progress: p };
    this.saving = this.saving
      .then(() => this.platform.updateBook(this.record.id, { progress: p }))
      .catch((e) => console.warn('保存阅读进度失败', e));
    return this.saving;
  }

  dispose(): void {
    if (this.disposed) return;
    void this.flush();
    this.disposed = true;
    this.mountSeq++;
    this.teardownView();
    useReaderStore.getState().reset();
  }
}

/** 等 n 个动画帧；页面在后台时 rAF 不触发，所以最多等 120ms */
function nextFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 120);
    let left = n;
    const tick = (): void => {
      if (--left <= 0) {
        clearTimeout(timer);
        resolve();
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
