// 章节文字与 DOM Range 之间的互换。偏移量一律指“章节全文”（body 里所有文本节点按文档顺序拼起来，
// 和 Range.toString() 对整个 body 的结果一致）里的 UTF-16 下标。
import { collapseSpace } from './anchoring';

export interface DocText {
  text: string;
  nodes: Text[];
  /** nodes[i] 的第一个字在 text 里的下标 */
  starts: number[];
}

const SHOW = NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION;

export function rootOf(doc: Document): HTMLElement {
  return (doc.body ?? doc.documentElement) as HTMLElement;
}

/** 整章文字。同一份文档反复用，调用方自己缓存 */
export function docText(doc: Document): DocText {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const walker = doc.createTreeWalker(rootOf(doc), SHOW);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    nodes.push(t);
    starts.push(text.length);
    text += t.data;
  }
  return { text, nodes, starts };
}

/** Range 在章节全文里的位置 */
export function rangeToOffsets(doc: Document, range: Range): { start: number; end: number } | null {
  try {
    const pre = doc.createRange();
    pre.setStart(rootOf(doc), 0);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    return { start, end: start + range.toString().length };
  } catch {
    return null;
  }
}

/** 章节全文里的 [start, end) 对应的 Range */
export function offsetsToRange(doc: Document, dt: DocText, start: number, end: number): Range | null {
  if (dt.nodes.length === 0 || end <= start) return null;
  // 最后一个 starts[i] <= pos 的节点
  const find = (pos: number, isEnd: boolean): { node: Text; offset: number } | null => {
    let lo = 0;
    let hi = dt.nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (dt.starts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    let i = lo;
    // 终点落在节点边界上时，归到前一个节点的末尾（免得把空节点算进来）
    if (isEnd && i > 0 && dt.starts[i] === pos) i--;
    const node = dt.nodes[i]!;
    return { node, offset: Math.max(0, Math.min(node.data.length, pos - dt.starts[i]!)) };
  };
  const a = find(start, false);
  const b = find(end, true);
  if (!a || !b) return null;
  const r = doc.createRange();
  try {
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
  } catch {
    return null;
  }
  return r;
}

/**
 * Range 里每个文本节点的矩形（只要文字本身，不要整段的方框）。
 * range.getClientRects() 遇到完整包含的元素会把元素的盒子也返回，高亮会画成一整段色块。
 */
export function textRects(range: Range): DOMRect[] {
  const doc = range.startContainer.ownerDocument!;
  const out: DOMRect[] = [];
  const root = range.commonAncestorContainer;
  const walker = doc.createTreeWalker(root.nodeType === 3 ? (root.parentNode ?? root) : root, SHOW);
  // 公共祖先本身是文本节点时，walker 从它的父元素开始，会遍历到兄弟文本节点，下面按 intersectsNode 过滤
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n)) continue;
    const t = n as Text;
    const r = doc.createRange();
    r.setStart(t, t === range.startContainer ? range.startOffset : 0);
    r.setEnd(t, t === range.endContainer ? range.endOffset : t.data.length);
    if (r.collapsed) continue;
    for (const rect of Array.from(r.getClientRects())) if (rect.width > 0.5 && rect.height > 0.5) out.push(rect);
  }
  return out;
}

export { collapseSpace };
