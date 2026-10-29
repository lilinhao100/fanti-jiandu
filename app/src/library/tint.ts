// 主页“继续阅读”卡片的底色：取封面的平均色（DESIGN 第 1 节），再压暗到白字读得清。
// 20% 白色叠加和渐变在 CSS 里（--c-card-overlay）。

export type Rgb = [number, number, number];

/** WCAG 相对亮度，0（黑）到 1（白） */
export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * 压暗到白字的对比度不低于 4.5（再叠 20% 白色之后仍然够，所以目标亮度取 0.12），
 * 同时往灰色靠 25%，让鲜艳的封面色在卡片上显得沉稳（截图里的卡片就是这种发灰的色调）。
 */
export function cardTint(avg: Rgb, maxLuminance = 0.12): Rgb {
  const gray = (avg[0] + avg[1] + avg[2]) / 3;
  let c: Rgb = [0, 1, 2].map((i) => avg[i]! * 0.75 + gray * 0.25) as Rgb;
  for (let n = 0; n < 40 && luminance(c) > maxLuminance; n++) c = c.map((v) => v * 0.93) as Rgb;
  return c.map((v) => Math.round(v)) as Rgb;
}

export const rgbCss = ([r, g, b]: Rgb): string => `rgb(${r} ${g} ${b})`;

/** 图片的平均色：缩到 16×16 再取平均 */
export function averageColor(img: CanvasImageSource): Rgb | null {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, 16, 16);
  const { data } = ctx.getImageData(0, 0, 16, 16);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    r += data[i]!;
    g += data[i + 1]!;
    b += data[i + 2]!;
    n++;
  }
  return n ? [r / n, g / n, b / n] : null;
}

/** 把任意 CSS 颜色（含 var 解析后的值）变成 RGB */
export function parseCssColor(css: string): Rgb | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!];
}
