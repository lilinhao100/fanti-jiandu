import { useLayoutEffect, useRef, useState } from 'react';

/** DESIGN 第 1 节：封面宽 185【采】，列间距 26【采】，封面宽度在 150–200 之间浮动、填满整行 */
export const COVER_TARGET = 185;
export const COVER_MIN = 150;
export const COVER_MAX = 200;
export const COL_GAP = 26;

/** 容器宽度 → 列数：列宽落在 150–200 里就行，多个都行时取最接近 185 的；都不行时取离区间最近的 */
export function columnsFor(width: number): number {
  if (width <= 0) return 1;
  const w = (n: number): number => (width - (n - 1) * COL_GAP) / n;
  const maxN = Math.max(1, Math.floor((width + COL_GAP) / (COVER_MIN * 0.9 + COL_GAP)));
  let best = 1;
  let bestKey: [number, number] = [Infinity, Infinity];
  for (let n = 1; n <= maxN; n++) {
    const cw = w(n);
    const outside = cw < COVER_MIN ? COVER_MIN - cw : cw > COVER_MAX ? cw - COVER_MAX : 0;
    const key: [number, number] = [outside, Math.abs(cw - COVER_TARGET)];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
      best = n;
      bestKey = key;
    }
  }
  return best;
}

/** 量容器宽度，算出列数；返回要绑到网格容器上的 ref 和 style */
export function useGridColumns<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [cols, setCols] = useState(4);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => setCols(columnsFor(el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, cols };
}
