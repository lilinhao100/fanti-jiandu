// 阅读窗口的版心：单页/双页阈值、外边距、中缝、上下边距（DESIGN 2.1），换算成 <foliate-paginator> 的属性。
//
// foliate 分页器的几何有一条限制（paginator.js:477-483、714）：外边距 ≥ 中缝。
// 而设计要求外边距 6.4%、中缝 6.9%（采样自参考截图），页边空白滑块还要把外边距缩到 0.5 倍。
// 所以让 <foliate-view> 自己比窗口宽（或窄）一点：左右各偏移 inset 像素，
// 使“外边距 = inset + 中缝”恰好等于想要的值。inset 可以是负数，超出窗口的部分被 .reader 的 overflow:hidden 裁掉，里面只是空白。
// 上边距 72（工具栏让位）、下边距 52（页脚）：分页器的 margin 属性上下共用，取 52，再把 view 整体下移 20。

/** 内容宽度 ≥ 1000px 双页，否则单页（DESIGN 2.1） */
export const TWO_PAGE_MIN_WIDTH = 1000;
export const TOP_MARGIN = 72;
export const BOTTOM_MARGIN = 52;
export const OUTER_RATIO = 0.064;
export const GUTTER_RATIO = 0.069;
/** 单页版心最大宽度（DESIGN 2.1） */
export const ONE_PAGE_MAX_TEXT = 680;
/** 超宽窗口里双页每栏的上限（M1 起沿用 760；设计没写，免得 4K 屏上一行几十个字） */
export const TWO_PAGE_MAX_COLUMN = 760;
/**
 * 单页时分页器里留的列间隙（页面里只有一栏，只是给文字和栏边界留一点空）。
 * M2c：24 → 36。两侧各留 18px，页边便签图标（12px，离文字 3px）才不会被页面边缘裁掉；版心宽度不变。
 */
const ONE_PAGE_GAP = 36;

export interface Layout {
  two: boolean;
  /** <foliate-view> 相对阅读窗口的偏移（px）；left/right 可为负 */
  inset: { left: number; right: number; top: number };
  /** 写到 <foliate-paginator> 上的属性 */
  attrs: { 'max-column-count': string; 'max-inline-size': string; gap: string; margin: string };
  /** 最终的版心（相对窗口），验收和单元测试用 */
  geometry: { outer: number; gutter: number; column: number };
}

const px = (n: number): string => `${Math.round(n * 100) / 100}px`;
const pct = (r: number): string => `${Math.round(r * 1e6) / 1e4}%`;

/**
 * @param width  阅读窗口宽（px）
 * @param height 阅读窗口高（px）
 * @param margin “页边空白”倍数 0.5–1.8，默认 1
 */
export function computeLayout(width: number, height: number, margin = 1): Layout {
  const W = Math.max(1, width);
  const m = Math.max(0.5, Math.min(1.8, margin));
  const top = TOP_MARGIN - BOTTOM_MARGIN;
  // 容器是竖屏（高 > 宽）时，分页器的 CSS 会强制单栏（paginator.js:495），所以竖屏窗口一律单页
  const two = W >= TWO_PAGE_MIN_WIDTH && height - top <= W;

  if (two) {
    const gutter = GUTTER_RATIO * W;
    let outer = OUTER_RATIO * W * m;
    let column = (W - 2 * outer - gutter) / 2;
    if (column > TWO_PAGE_MAX_COLUMN) {
      column = TWO_PAGE_MAX_COLUMN;
      outer = (W - gutter - 2 * column) / 2;
    }
    const inset = outer - gutter;
    const wide = W - 2 * inset; // <foliate-view> 的实际宽度
    const container = wide - gutter; // 分页器容器宽 = view 宽 - 中缝（两侧各半个中缝作最小留白）
    return {
      two,
      inset: { left: inset, right: inset, top },
      attrs: {
        'max-column-count': '2',
        // 要让 ceil(容器宽 / max-inline-size) = 2，同时 max-inline-size × 2 ≥ 容器宽
        'max-inline-size': px(container * 0.6),
        gap: pct(gutter / wide),
        margin: px(BOTTOM_MARGIN),
      },
      geometry: { outer, gutter, column },
    };
  }

  // 单页：版心宽 T，水平居中。页边空白倍数大于 1 时窗口窄处版心跟着变窄；小于 1 时放宽上限
  const cap = ONE_PAGE_MAX_TEXT / Math.min(m, 1);
  const text = Math.max(Math.min(200, W), Math.min(cap, W * (1 - 2 * OUTER_RATIO * m)));
  const gap = ONE_PAGE_GAP;
  const container = text + gap; // 容器 = 版心 + 两侧各半个列间隙
  return {
    two,
    inset: { left: 0, right: 0, top },
    attrs: {
      'max-column-count': '1',
      'max-inline-size': px(container),
      gap: pct(gap / (container + gap) ),
      margin: px(BOTTOM_MARGIN),
    },
    geometry: { outer: (W - text) / 2, gutter: 0, column: text },
  };
}
