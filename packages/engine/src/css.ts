import type { ConvertOptions } from './types';

const VERTICAL_WRITING_MODE =
  /((?:-epub-|-webkit-)?writing-mode\s*:\s*)(vertical-rl|vertical-lr|tb-rl|tb-lr|sideways-rl|sideways-lr)(?![\w-])/gi;

/**
 * CSS 转换：horizontal 开时，把 writing-mode / -epub-writing-mode / -webkit-writing-mode
 * 的竖排取值改成 horizontal-tb。其余内容原样保留（包括 !important 和注释）。
 */
export function transformCss(css: string, opts: ConvertOptions): string {
  if (!opts.horizontal) return css;
  return css.replace(VERTICAL_WRITING_MODE, (_m, head: string) => head + 'horizontal-tb');
}
