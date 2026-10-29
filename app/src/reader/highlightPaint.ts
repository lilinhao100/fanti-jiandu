// 高亮和下划线怎么画（DESIGN 2.8）。颜色是 SVG 属性，不能引用 CSS 变量，所以这里有一份和 tokens.css 的
// --c-hl-* 相同的值（界面里的色点用后者）。改色值要两处一起改。
import { Overlayer } from 'foliate-js/overlayer.js';
import type { Highlight } from '../model';

export type HighlightStyle = Highlight['style'];
export const HIGHLIGHT_STYLES: HighlightStyle[] = ['yellow', 'green', 'blue', 'pink', 'purple', 'underline'];
export const COLOR_STYLES = ['yellow', 'green', 'blue', 'pink', 'purple'] as const;

/** 半透明色块：浅色页面 multiply 叠加，深色页面 40% 不透明的普通叠加（DESIGN 2.8） */
export const HL_PAINT: Record<Exclude<HighlightStyle, 'underline'>, { color: string; opacity: number }> = {
  // 参考界面里取到的就是不透明色值本身（multiply 下文字仍是黑的），故浅色页面用 1；
  // 绿、紫没有参考，取与黄、蓝、粉同等明度的浅色
  yellow: { color: '#FFDC00', opacity: 1 },
  green: { color: '#B2E68C', opacity: 1 },
  blue: { color: '#8DB8FF', opacity: 1 },
  pink: { color: '#FF94B3', opacity: 1 },
  purple: { color: '#CFB0FF', opacity: 1 },
};
export const UNDERLINE_PAINT = { color: '#FF383C', width: 2 };
export const DARK_OPACITY = 0.4;
/** 页边便签图标的边长（DESIGN 2.8） */
export const NOTE_ICON = 12;

export const styleColor = (s: HighlightStyle): string => (s === 'underline' ? UNDERLINE_PAINT.color : HL_PAINT[s].color);

/** 按 sRGB 相对亮度粗判页面是深是浅（#rrggbb） */
export function isDarkBackground(bg: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim());
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) < 0.2;
}

export interface PaintOptions {
  style: HighlightStyle;
  /** 页面是深色：用普通叠加，不用 multiply */
  dark: boolean;
  writingMode?: string;
}

const svg = <K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] => document.createElementNS('http://www.w3.org/2000/svg', tag);

/** 一条标注的图形：高亮是半透明色块，下划线是 2px 红线。 */
export function paintHighlight(rects: Iterable<DOMRect>, o: PaintOptions): SVGGElement {
  const g = svg('g');
  if (o.style === 'underline') {
    g.append(Overlayer.underline(rects, { color: UNDERLINE_PAINT.color, width: UNDERLINE_PAINT.width, writingMode: o.writingMode }));
    return g;
  }
  const p = HL_PAINT[o.style];
  const h = Overlayer.highlight(rects, { color: p.color });
  h.style.opacity = String(o.dark ? DARK_OPACITY : p.opacity);
  h.style.mixBlendMode = o.dark ? 'normal' : 'multiply';
  // 参考截图里色块的四角是圆的
  for (const r of Array.from(h.querySelectorAll('rect'))) r.setAttribute('rx', '3');
  g.append(h);
  return g;
}

/** 页边的小便签：12px 圆角色块，里面两道短线 */
export function noteIcon(x: number, y: number, color: string): SVGGElement {
  const g = svg('g');
  g.setAttribute('data-note-icon', '');
  const body = svg('rect');
  body.setAttribute('x', String(x));
  body.setAttribute('y', String(y));
  body.setAttribute('width', String(NOTE_ICON));
  body.setAttribute('height', String(NOTE_ICON));
  body.setAttribute('rx', '3');
  body.setAttribute('fill', color);
  const lines = svg('path');
  lines.setAttribute('d', `M${x + 3} ${y + 4.2}h6M${x + 3} ${y + 7.4}h4`);
  lines.setAttribute('stroke', 'rgba(0,0,0,.55)');
  lines.setAttribute('stroke-width', '1.2');
  lines.setAttribute('stroke-linecap', 'round');
  lines.setAttribute('fill', 'none');
  g.append(body, lines);
  return g;
}

/**
 * 便签图标的位置：段落右侧的页边。段落被分栏截成几段时，取包含这条高亮第一行的那一段的右边缘。
 * 返回左上角坐标（和 Overlayer 同一个坐标系：iframe 文档的视口坐标）。
 */
export function notePosition(range: Range, rects: DOMRect[]): { x: number; y: number } | null {
  const first = rects[0];
  if (!first) return null;
  const startEl = range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement;
  const block = startEl?.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, td, th, figcaption, div') ?? null;
  let right = first.right;
  if (block) {
    const frags = Array.from(block.getClientRects());
    const hit = frags.find((f) => f.left <= first.left + 1 && f.right >= first.right - 1 && f.top <= first.top + 3 && f.bottom >= first.bottom - 3);
    if (hit) right = hit.right;
  }
  return { x: right + 3, y: first.top + (first.height - NOTE_ICON) / 2 };
}
