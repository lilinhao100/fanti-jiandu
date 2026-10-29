// 阅读区样式：根据 Settings 生成，通过 renderer.setStyles([before, after]) 注入。
// 注意（笔记第 5 节）：不要碰 paginator 用 !important 占用的 documentElement 属性
// （column-width、column-gap、height、padding、overflow 等）。
import { presetRef, type FontId, type FontRef, type Settings, type ThemeId } from '../model';
import { bodyFontFamily, clampFontSize, FALLBACK_STACK, FONT_STACK } from './fonts';

export { FONT_STACK };

interface Palette {
  bg: string;
  fg: string;
}

/** DESIGN.md 2.6 */
const LIGHT: Record<ThemeId, Palette> = {
  original: { bg: '#FFFFFF', fg: '#000000' },
  quiet: { bg: '#4A4A4D', fg: '#EBEBF5' },
  paper: { bg: '#EEEDED', fg: '#1C1C1E' },
  bold: { bg: '#FFFFFF', fg: '#000000' },
  calm: { bg: '#F0E2C9', fg: '#241A13' },
  focus: { bg: '#FFFCF4', fg: '#1A1A1A' },
};

const DARK: Record<ThemeId, Palette> = {
  original: { bg: '#000000', fg: '#E6E6E6' },
  quiet: { bg: '#4A4A4D', fg: '#EBEBF5' },
  paper: { bg: '#2A2A2A', fg: '#D9D9D9' },
  bold: { bg: '#000000', fg: '#FFFFFF' },
  calm: { bg: '#3A3127', fg: '#E8DCC6' },
  focus: { bg: '#1F1D1A', fg: '#E8E2D6' },
};

/** 主题自带的字体（DESIGN 2.6）。original 没有自带的，用设置里的默认字体（默认宋体；选“原始”就是书里的字体） */
const THEME_FONT: Record<ThemeId, FontId | null> = {
  original: null,
  quiet: 'songti',
  paper: 'songti',
  bold: 'yahei',
  calm: 'songti',
  focus: 'songti',
};

export interface ReaderStyleInput {
  appearance: Settings['appearance'];
  horizontal: boolean;
  /** auto 模式下由调用方传入系统是否为深色 */
  systemDark?: boolean;
  /** 导入字体的 @font-face 规则（platform.fontFaceCss()），和正文样式一起注入阅读 iframe */
  fontFaceCss?: string;
}

/** 主题方块：名称与 6 个主题（DESIGN 2.5、2.6），顺序即 2 行 × 3 列 */
export const THEMES: { id: ThemeId; name: string }[] = [
  { id: 'original', name: '原始' },
  { id: 'quiet', name: '安静' },
  { id: 'paper', name: '纸张' },
  { id: 'bold', name: '粗体' },
  { id: 'calm', name: '平静' },
  { id: 'focus', name: '专注' },
];

/** 主题方块的样子：底色一律取浅色配色（参考截图里深色模式下方块颜色不变）；“Aa”用该主题的字体和字重 */
export function themeSwatch(id: ThemeId): { bg: string; fg: string; fontFamily: string; fontWeight: number } {
  const font = THEME_FONT[id];
  return {
    bg: LIGHT[id].bg,
    fg: LIGHT[id].fg,
    // 原始主题没有自带字体，方块里取界面无衬线（参考截图 Original 是无衬线）
    fontFamily: font ? FONT_STACK[font as Exclude<FontId, 'default'>] : 'var(--font-ui)',
    fontWeight: id === 'bold' ? 700 : 400,
  };
}

export function resolvePalette(a: Settings['appearance'], systemDark = false): Palette & { dark: boolean } {
  const dark = a.mode === 'dark' || (a.mode === 'auto' && systemDark);
  return { ...(dark ? DARK : LIGHT)[a.theme], dark };
}

/** 现在实际用的字体：用户选了就用他选的（覆盖主题），否则主题自带的，原始主题用默认字体；default = 书里指定的 */
export function effectiveFont(a: Settings['appearance']): FontRef {
  if (a.fontPinned) return a.font;
  const themed = THEME_FONT[a.theme];
  return themed ? presetRef(themed) : a.font;
}

/** 正文字号（px）。设置里存的就是 px，这里只做夹紧 */
export function fontSizePx(px: number): number {
  return clampFontSize(px);
}

/** 返回 [beforeStyle, style]：前者在书的样式之前（可被书覆盖），后者在书的样式之后（用 !important 压过书） */
export function buildReaderStyles(input: ReaderStyleInput): [string, string] {
  const { appearance: a, horizontal } = input;
  const pal = resolvePalette(a, input.systemDark);
  const size = fontSizePx(a.fontSize);
  const family = bodyFontFamily(effectiveFont(a), a.fontWest);
  const bold = a.bold || a.theme === 'bold';
  const lineHeight = a.custom ? a.lineHeight : 1.8;
  const letterSpacing = a.custom ? a.letterSpacing : 0.02;
  const wordSpacing = a.custom ? a.wordSpacing : 0;
  const justify = a.custom ? a.justify : true;

  const before = `
html { font-family: ${FALLBACK_STACK}; }
p { text-indent: 2em; }
`;

  const faces = input.fontFaceCss ? `${input.fontFaceCss}
` : '';
  const after = `${faces}
@namespace epub "http://www.idpf.org/2007/ops";
html {
  color-scheme: ${pal.dark ? 'dark' : 'light'};
  font-size: ${size}px !important;
  -webkit-text-size-adjust: 100%;
}
html, body {
  background: ${pal.bg} !important;
  color: ${pal.fg} !important;
${horizontal ? '  writing-mode: horizontal-tb !important;\n  -webkit-writing-mode: horizontal-tb !important;\n  direction: ltr !important;\n' : ''}}
body {
${family ? `  font-family: ${family} !important;\n` : ''}${bold ? '  font-weight: 700 !important;\n' : ''}  letter-spacing: ${letterSpacing}em !important;
  word-spacing: ${wordSpacing}em !important;
}
p, li, blockquote, dd {
  line-height: ${lineHeight} !important;
  text-align: ${justify ? 'justify' : 'start'};
  hanging-punctuation: allow-end last;
  widows: 2;
}
[align="left"] { text-align: left; }
[align="right"] { text-align: right; }
[align="center"] { text-align: center; }
a:link, a:visited { color: ${pal.dark ? '#8CB8FF' : '#0A5BC4'}; }
pre { white-space: pre-wrap !important; }
aside[epub|type~="endnote"], aside[epub|type~="footnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
::selection { background: ${pal.dark ? 'rgba(80,140,255,.45)' : '#CCE7FE'}; }
`;
  return [before, after];
}
