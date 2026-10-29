// @font-face 规则与 font-family 家族名的转义。纯函数：界面、主进程、测试都用它。

/** 家族名写进 CSS 要加引号并转义：反斜杠、双引号、换行都可能出现在用户导入的字体名里 */
export function quoteFamily(name: string): string {
  // 控制字符一律换成空格；CSS 字符串里的 \ 和 " 用反斜杠转义
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, ' ');
  return `"${clean.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export type FontFileFormat = 'ttf' | 'otf' | 'woff' | 'woff2';

const FORMAT_HINT: Record<FontFileFormat, string> = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' };

/** CSS url() 里的地址也要转义，免得字体文件名里的引号、括号、换行截断规则 */
export function cssUrl(url: string): string {
  return `url("${url.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
}

export interface FontFaceSpec {
  family: string;
  url: string;
  format: FontFileFormat;
  weight: number;
  italic: boolean;
}

export function fontFaceRule(f: FontFaceSpec): string {
  return (
    `@font-face { font-family: ${quoteFamily(f.family)}; src: ${cssUrl(f.url)} format("${FORMAT_HINT[f.format]}"); ` +
    `font-weight: ${Math.max(1, Math.min(1000, Math.round(f.weight)))}; font-style: ${f.italic ? 'italic' : 'normal'}; font-display: swap; }`
  );
}
