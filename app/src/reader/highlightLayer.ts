// 高亮层：创建、画、重新定位、选区菜单、笔记入口。控制器把 foliate 的事件转进来，界面（React）读 store、调这里的方法。
// 设计依据：ARCHITECTURE 3.4（Highlight）、3.6（标注定位）；DESIGN 2.8。
//
// 画法：直接用每章的 Overlayer（view.renderer.getContents()[i].overlayer），key 是 `hl:<id>`，范围是我们自己定位出来的 Range。
// 不走 view.addAnnotation：它要求 value 是能解析成位置的 CFI，而重新定位后的 Range 不一定有对应的存档 CFI。
// Overlayer 自己记着 Range，分页器每次重排会调 redraw()，所以改字号、改窗口后高亮会跟着文字走。
import { ENGINE_VERSION, convertText, type ConvertOptions } from '@fjd/engine';
import type { Highlight } from '../model';
import { useReaderStore, type Box, type HighlightInfo } from '../store/reader';
import { buildKeyIndex, collapseSpace, contextOf, foldString, locateInIndex, makeFold, trimSpan, type Fold, type KeyIndex, type TextSpan } from './anchoring';
import { docText, offsetsToRange, rangeToOffsets, textRects, type DocText } from './domText';
import type { FoliateBook, FoliateView, OverlayerLike } from './foliateTypes';
import { NOTE_ICON, noteIcon, notePosition, paintHighlight, styleColor, type HighlightStyle } from './highlightPaint';
import { optsKey } from './options';

export const HL_KEY = 'hl:';

export interface LayerDeps {
  view(): FoliateView | null;
  book(): FoliateBook | null;
  /** 现在显示的模式和引擎选项；书还没打开时为 null */
  display(): { mode: 'converted' | 'original'; opts: ConvertOptions } | null;
  /** 页面是深色（主题的背景色够暗） */
  darkPage(): boolean;
  list(): Highlight[];
  /** 保存并更新 store */
  commit(next: Highlight[]): void;
  chapterOf(index: number): string;
}

interface DrawOpts {
  id: string;
  style: HighlightStyle;
  dark: boolean;
  note: boolean;
  writingMode?: string;
  range: Range;
  index: number;
}

interface Pending {
  doc: Document;
  index: number;
  range: Range;
}

export type HitKind = { kind: 'highlight'; id: string } | { kind: 'note'; id: string };

const newId = (): string => `hl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export class HighlightLayer {
  /** 当前选区（菜单上的“新建”操作用它）；点在已有高亮上时是 null */
  private pending: Pending | null = null;
  private menuAt = '';
  /** 画出来的高亮：id → 所在章节与 Range（只有已加载的章节有） */
  private ranges = new Map<string, { index: number; range: Range; doc: Document }>();
  private noteHits = new Map<string, { index: number; x: number; y: number }>();
  private sectionOf = new Map<string, number>();
  private infos = new Map<string, HighlightInfo>();
  private resolveSeq = 0;
  private fold: Fold | null = null;
  private foldVariant = '';

  constructor(private readonly d: LayerDeps) {}

  /** 换书、重开、关闭时清掉所有状态 */
  reset(): void {
    this.pending = null;
    this.ranges.clear();
    this.noteHits.clear();
    this.sectionOf.clear();
    this.infos.clear();
    this.resolveSeq++;
    useReaderStore.getState().set({ menu: null, noteEditor: null, hlInfo: {} });
  }

  /** 给测试和调试用 */
  debug(): { id: string; text: string; start: number; located: boolean; index: number }[] {
    return this.d.list().map((h) => {
      const info = this.infos.get(h.id);
      const live = this.ranges.get(h.id);
      return { id: h.id, text: live ? live.range.toString() : '', start: info?.start ?? -1, located: !!info?.located, index: info?.index ?? -1 };
    });
  }

  // ------------------------------------------------------------------ 定位

  private foldFor(): Fold {
    const v = this.d.display()?.opts.variant ?? 'tw';
    if (!this.fold || this.foldVariant !== v) {
      this.fold = makeFold(v);
      this.foldVariant = v;
    }
    return this.fold;
  }

  /** 高亮在第几章：从 CFI 里读（不需要章节已经加载） */
  private sectionIndex(h: Highlight): number {
    const hit = this.sectionOf.get(h.cfi);
    if (hit !== undefined) return hit;
    let i = -1;
    try {
      i = this.d.view()?.resolveCFI(h.cfi).index ?? -1;
    } catch {
      i = -1;
    }
    this.sectionOf.set(h.cfi, i);
    return i;
  }

  /**
   * 在一章里找一条高亮（ARCHITECTURE 3.6）：先用 CFI，再核对文字（折叠后相等才算数）；
   * 对不上（换了模式、引擎版本变了）就在整章里按 prefix、text、suffix 模糊查找。
   */
  private locate(doc: Document, dt: DocText, ki: KeyIndex, h: Highlight): TextSpan | null {
    const fold = this.foldFor();
    try {
      const view = this.d.view();
      if (view) {
        const r = view.resolveCFI(h.cfi).anchor(doc);
        const off = r ? rangeToOffsets(doc, r) : null;
        if (off && off.end > off.start) {
          const got = foldString(dt.text.slice(off.start, off.end), fold);
          if (got && got === foldString(h.text, fold)) return { start: off.start, end: off.end, how: 'exact' };
        }
      }
    } catch {
      // CFI 在这份文档里指不到东西：走模糊查找
    }
    return locateInIndex(ki, h, fold);
  }

  private unlocated(h: Highlight, index: number): HighlightInfo {
    const disp = this.d.display();
    // 存的是繁体原文、现在显示简体：按当前模式转一下再给人看
    const text = disp && h.anchor.mode === 'original' ? convertText(h.text, disp.opts) : h.text;
    return { index, start: 0, end: 0, located: false, chapter: '', text: collapseSpace(text).trim() };
  }

  /**
   * 给所有高亮算一遍“在哪、找没找到”（要点精选面板用）。没加载的章节用 createDocument 取文字：
   * 它经过同一套引擎转换，和页面上渲染出来的是同一份文字（foliate-hooks.md 第 3 节）。
   */
  async resolveAll(): Promise<void> {
    const seq = ++this.resolveSeq;
    const view = this.d.view();
    const book = this.d.book();
    if (!view || !book || !this.d.display()) return;
    const fold = this.foldFor();
    const list = this.d.list();
    const bySection = new Map<number, Highlight[]>();
    const infos: Record<string, HighlightInfo> = {};
    for (const h of list) {
      const i = this.sectionIndex(h);
      if (i < 0) infos[h.id] = this.unlocated(h, -1);
      else bySection.set(i, [...(bySection.get(i) ?? []), h]);
    }
    for (const [index, hs] of bySection) {
      let doc: Document | null = view.renderer.getContents().find((c) => c.index === index)?.doc ?? null;
      if (!doc) {
        try {
          doc = (await book.sections[index]?.createDocument?.()) ?? null;
        } catch (e) {
          console.warn(e);
        }
      }
      if (seq !== this.resolveSeq || this.d.view() !== view) return; // 被新一轮取代，或书已经关了
      if (!doc) {
        for (const h of hs) infos[h.id] = this.unlocated(h, index);
        continue;
      }
      const dt = docText(doc);
      const ki = buildKeyIndex(dt.text, fold);
      for (const h of hs) {
        const span = this.locate(doc, dt, ki, h);
        infos[h.id] = span
          ? { index, start: span.start, end: span.end, located: true, chapter: this.d.chapterOf(index), text: collapseSpace(dt.text.slice(span.start, span.end)).trim() }
          : { ...this.unlocated(h, index), index };
      }
    }
    if (seq !== this.resolveSeq) return;
    this.infos = new Map(Object.entries(infos));
    useReaderStore.getState().set({ hlInfo: infos });
  }

  // ------------------------------------------------------------------ 画

  /** 章节的覆盖层建好了（create-overlay）：把这一章的高亮画上去 */
  drawSection(index: number): void {
    const view = this.d.view();
    if (!view || !this.d.display()) return;
    const c = view.renderer.getContents().find((x) => x.index === index);
    const ov = c?.overlayer;
    if (!c || !ov || !c.doc?.documentElement) return; // 章节正在换、或视图已销毁
    for (const [id, r] of this.ranges) {
      // 别的章节已经卸载（一次只显示一章），它们的 Range 和覆盖层都作废了
      if (r.index === index) ov.remove(HL_KEY + id);
      this.ranges.delete(id);
      this.noteHits.delete(id);
    }
    const mine = this.d.list().filter((h) => this.sectionIndex(h) === index);
    if (mine.length === 0) return;
    const doc = c.doc;
    const dt = docText(doc);
    const ki = buildKeyIndex(dt.text, this.foldFor());
    for (const h of mine) {
      const span = this.locate(doc, dt, ki, h);
      const range = span ? offsetsToRange(doc, dt, span.start, span.end) : null;
      if (!range) continue;
      this.ranges.set(h.id, { index, range, doc });
      this.paint(ov, doc, h, range, index);
    }
  }

  /** 重画当前已加载的章节（高亮增删改、主题变化后） */
  redrawAll(): void {
    const view = this.d.view();
    if (!view) return;
    for (const c of view.renderer.getContents()) this.drawSection(c.index);
  }

  private paint(ov: OverlayerLike, doc: Document, h: Highlight, range: Range, index: number): void {
    const opts: DrawOpts = {
      id: h.id,
      style: h.style,
      dark: this.d.darkPage(),
      note: !!h.note,
      writingMode: doc.defaultView?.getComputedStyle(doc.body).writingMode,
      range,
      index,
    };
    // 代理对象：Overlayer 只调 getClientRects()，我们让它只返回文字的矩形（不含整段的方框）
    ov.add(HL_KEY + h.id, { getClientRects: () => textRects(range) }, (rects, o) => this.draw(Array.from(rects), o as DrawOpts), opts);
  }

  private draw(rects: DOMRect[], o: DrawOpts): SVGGElement {
    const g = paintHighlight(rects, o);
    g.setAttribute('data-hl', o.id);
    g.setAttribute('data-style', o.style);
    if (o.note) {
      const pos = notePosition(o.range, rects);
      if (pos) {
        g.append(noteIcon(pos.x, pos.y, styleColor(o.style)));
        this.noteHits.set(o.id, { index: o.index, x: pos.x, y: pos.y });
      }
    } else this.noteHits.delete(o.id);
    return g;
  }

  // ------------------------------------------------------------------ 点击命中

  /** 文档里这个点在哪条高亮上、或者在哪个便签图标上（用来拦住“点击翻页”） */
  hitAt(doc: Document, x: number, y: number): HitKind | null {
    const view = this.d.view();
    const c = view?.renderer.getContents().find((k) => k.doc === doc);
    if (!c) return null;
    for (const [id, h] of this.noteHits) {
      if (h.index === c.index && x >= h.x - 3 && x <= h.x + NOTE_ICON + 3 && y >= h.y - 3 && y <= h.y + NOTE_ICON + 3) return { kind: 'note', id };
    }
    const [key] = c.overlayer?.hitTest({ x, y }) ?? [];
    return key && key.startsWith(HL_KEY) ? { kind: 'highlight', id: key.slice(HL_KEY.length) } : null;
  }

  /** foliate 的 show-annotation：点在了某条高亮上 */
  onShowAnnotation(value: string): void {
    if (!value.startsWith(HL_KEY)) return;
    const id = value.slice(HL_KEY.length);
    const h = this.d.list().find((x) => x.id === id);
    const live = this.ranges.get(id);
    if (!h || !live) return;
    const sel = live.doc.getSelection();
    if (sel && sel.type === 'Range') return; // 正在选字：选区菜单优先
    this.pending = null;
    this.openMenu(live.doc, live.range, { hid: id, style: h.style });
  }

  // ------------------------------------------------------------------ 选区菜单

  /** 文档里鼠标抬起、键盘选择结束：看看有没有选区 */
  checkSelection(doc: Document, index: number): void {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString().trim()) {
      if (this.pending) this.hideMenu();
      return;
    }
    const range = sel.getRangeAt(0).cloneRange();
    this.pending = { doc, index, range };
    this.openMenu(doc, range, { hid: null, style: null });
  }

  private openMenu(doc: Document, range: Range, extra: { hid: string | null; style: HighlightStyle | null }): void {
    const box = this.hostBox(doc, range);
    if (!box) return;
    const vw = window.innerWidth;
    const x = Math.max(190, Math.min((box.left + box.right) / 2, vw - 190));
    const below = box.top < 64;
    this.menuAt = this.pageKey();
    useReaderStore.getState().set({ menu: { x, y: below ? box.bottom + 8 : box.top - 8, below, ...extra }, noteEditor: null });
  }

  /** 现在在第几章第几页（翻页后菜单要关掉；排版变化引起的 relocate 页码不变，不关） */
  private pageKey(): string {
    const r = this.d.view()?.renderer;
    return r ? `${r.getContents()[0]?.index}:${r.page}` : '';
  }

  /** 控制器在每次 relocate 时调用 */
  onRelocate(): void {
    if (this.menuAt && useReaderStore.getState().menu && this.pageKey() !== this.menuAt) this.hideMenu();
  }

  hideMenu(): void {
    this.menuAt = '';
    this.pending = null;
    if (useReaderStore.getState().menu) useReaderStore.getState().set({ menu: null });
  }

  /** 点页面别处：关掉菜单和笔记弹窗。返回是否真的关掉了什么（这次点击就不要翻页） */
  dismiss(): boolean {
    const st = useReaderStore.getState();
    const had = !!st.menu || !!st.noteEditor;
    if (st.noteEditor) this.closeNote();
    if (st.menu) this.hideMenu();
    return had;
  }

  /** Esc：先关笔记弹窗，再关菜单（并取消选区）。返回是否处理了 */
  escape(): boolean {
    const st = useReaderStore.getState();
    if (st.noteEditor) {
      this.closeNote();
      return true;
    }
    if (st.menu) {
      this.clearSelection();
      this.hideMenu();
      return true;
    }
    return false;
  }

  private clearSelection(): void {
    try {
      this.pending?.doc.getSelection()?.removeAllRanges();
    } catch {
      // 文档已经销毁
    }
  }

  /** 视口坐标下，这段文字当前可见部分的外框 */
  private hostBox(doc: Document, range: Range): Box | null {
    const frame = doc.defaultView?.frameElement as HTMLElement | null;
    const fr = frame?.getBoundingClientRect();
    const dx = fr?.left ?? 0;
    const dy = fr?.top ?? 0;
    const rects = textRects(range);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const vis = rects.filter((r) => r.right + dx > 0 && r.left + dx < vw && r.bottom + dy > 0 && r.top + dy < vh);
    const use = vis.length > 0 ? vis : rects;
    if (use.length === 0) return null;
    return {
      left: Math.min(...use.map((r) => r.left)) + dx,
      top: Math.min(...use.map((r) => r.top)) + dy,
      right: Math.max(...use.map((r) => r.right)) + dx,
      bottom: Math.max(...use.map((r) => r.bottom)) + dy,
    };
  }

  // ------------------------------------------------------------------ 增删改

  /** 选区或点中的高亮：设颜色/下划线。选区会新建一条；点中已有的就改它的样式 */
  applyStyle(style: HighlightStyle): string | null {
    const menu = useReaderStore.getState().menu;
    if (menu?.hid) {
      this.update(menu.hid, { style });
      this.hideMenu();
      return menu.hid;
    }
    const id = this.createFromSelection(style);
    this.clearSelection();
    this.hideMenu();
    return id;
  }

  /** 菜单上的“笔记”：没有高亮就先建一条黄色的，再打开笔记弹窗 */
  startNote(): void {
    const menu = useReaderStore.getState().menu;
    let id = menu?.hid ?? null;
    if (!id) {
      id = this.createFromSelection('yellow');
      this.clearSelection();
    }
    this.hideMenu();
    if (id) this.openNote(id);
  }

  private createFromSelection(style: HighlightStyle): string | null {
    const p = this.pending;
    const view = this.d.view();
    const disp = this.d.display();
    if (!p || !view || !disp) return null;
    const dt = docText(p.doc);
    const off = rangeToOffsets(p.doc, p.range);
    if (!off) return null;
    const tight = trimSpan(dt.text, off.start, off.end);
    if (!tight) return null;
    const range = offsetsToRange(p.doc, dt, tight.start, tight.end);
    if (!range) return null;
    const list = this.d.list();
    // 同一段文字再选一次：只改样式，不叠出第二条
    const same = list.find((h) => {
      const info = this.infos.get(h.id);
      return info?.located && info.index === p.index && info.start === tight.start && info.end === tight.end;
    });
    if (same) {
      this.update(same.id, { style });
      return same.id;
    }
    const now = Date.now();
    const { prefix, suffix } = contextOf(dt.text, tight.start, tight.end);
    const h: Highlight = {
      id: newId(),
      cfi: view.getCFI(p.index, range),
      text: collapseSpace(dt.text.slice(tight.start, tight.end)).trim(),
      prefix,
      suffix,
      style,
      createdAt: now,
      updatedAt: now,
      anchor: { mode: disp.mode, engine: ENGINE_VERSION, optsKey: optsKey(disp.opts) },
    };
    this.sectionOf.set(h.cfi, p.index);
    this.d.commit([...list, h]);
    this.afterChange();
    return h.id;
  }

  update(id: string, patch: Partial<Pick<Highlight, 'style' | 'note'>>): void {
    const list = this.d.list();
    if (!list.some((h) => h.id === id)) return;
    this.d.commit(list.map((h) => (h.id === id ? { ...h, ...patch, updatedAt: Date.now() } : h)));
    this.afterChange();
  }

  remove(id: string): void {
    const list = this.d.list();
    if (!list.some((h) => h.id === id)) return;
    const st = useReaderStore.getState();
    if (st.noteEditor?.id === id) st.set({ noteEditor: null });
    this.d.commit(list.filter((h) => h.id !== id));
    this.afterChange();
  }

  private afterChange(): void {
    this.redrawAll();
    void this.resolveAll();
  }

  /** 笔记：空串就是删掉笔记（高亮保留） */
  setNote(id: string, note: string): void {
    const h = this.d.list().find((x) => x.id === id);
    if (!h) return;
    const next = note.trim() === '' ? undefined : note;
    if (next === h.note) return;
    this.update(id, { note: next });
  }

  // ------------------------------------------------------------------ 笔记弹窗

  /** rect 不给就围着页面上的这条高亮放 */
  openNote(id: string, rect?: Box, from: 'page' | 'panel' = 'page'): void {
    let box = rect ?? null;
    if (!box) {
      const live = this.ranges.get(id);
      box = live ? this.hostBox(live.doc, live.range) : null;
    }
    if (!box) box = { left: window.innerWidth / 2 - 150, top: 120, right: window.innerWidth / 2 + 150, bottom: 140 };
    useReaderStore.getState().set({ noteEditor: { id, rect: box, from }, menu: null });
  }

  closeNote(): void {
    if (useReaderStore.getState().noteEditor) useReaderStore.getState().set({ noteEditor: null });
  }

  // ------------------------------------------------------------------ 拷贝

  /** 复制的是当前显示的文字：选区的就是页面上选中的，点中已有高亮的就是它现在显示的文字 */
  async copy(): Promise<string> {
    const menu = useReaderStore.getState().menu;
    let text = '';
    if (menu?.hid) text = this.ranges.get(menu.hid)?.range.toString() ?? this.infos.get(menu.hid)?.text ?? '';
    else text = this.pending?.doc.getSelection()?.toString() || this.pending?.range.toString() || '';
    text = text.replace(/[ \t]*\n[ \t]*/g, '\n').trim();
    if (text) await writeClipboard(text);
    this.hideMenu();
    return text;
  }

  /** 要点精选里“复制”也可以用：高亮现在显示的文字 */
  liveText(id: string): string {
    return this.ranges.get(id)?.range.toString() ?? this.infos.get(id)?.text ?? '';
  }

  // ------------------------------------------------------------------ 跳转

  /** 跳到一条高亮。定位不上时只能翻到那一章；返回是否精确跳到了 */
  async goTo(id: string): Promise<boolean> {
    const view = this.d.view();
    const book = this.d.book();
    const h = this.d.list().find((x) => x.id === id);
    if (!view || !book || !h) return false;
    const info = this.infos.get(id);
    if (!info?.located) {
      const i = this.sectionIndex(h);
      if (i >= 0) await view.goTo(i);
      return false;
    }
    let range = this.ranges.get(id)?.range ?? null;
    if (!range) {
      const doc = await book.sections[info.index]?.createDocument?.();
      if (!doc) return false;
      range = offsetsToRange(doc, docText(doc), info.start, info.end);
    }
    if (!range) return false;
    await view.goTo(view.getCFI(info.index, range));
    return true;
  }
}

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // 没有剪贴板权限（非安全上下文、被拒绝）：退回 execCommand
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-1000px;top:0;opacity:0';
  document.body.append(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    ta.remove();
  }
}
