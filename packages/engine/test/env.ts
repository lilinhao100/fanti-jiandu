import { DOMParser as LinkedomDOMParser } from 'linkedom';
import { DEFAULT_OPTIONS, transformMarkup } from '../src/index';
import type { BookContext, ConvertOptions, TraceEvent, TransformEnv } from '../src/index';

/** linkedom 没有 XMLSerializer；它的 toString() 对 XML 文档就是 XML 序列化。 */
class ShimXMLSerializer {
  serializeToString(node: Node): string {
    return String(node);
  }
}

export const env: TransformEnv = {
  DOMParser: LinkedomDOMParser as unknown as typeof DOMParser,
  XMLSerializer: ShimXMLSerializer as unknown as typeof XMLSerializer,
};

/** 不容易在源码里看清的字符，统一用名字引用 */
export const NBSP = String.fromCharCode(0xa0);
export const IDEO_SPACE = String.fromCharCode(0x3000);

export const XHTML = 'application/xhtml+xml';

export function xhtml(inner: string, head = ''): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title>' +
    head +
    '</head><body>' +
    inner +
    '</body></html>'
  );
}

export function opts(over: Partial<ConvertOptions> = {}): ConvertOptions {
  return { ...DEFAULT_OPTIONS, ...over };
}

export function run(
  inner: string,
  o: Partial<ConvertOptions> = {},
  ctx: BookContext = { pdfReflow: false },
  head = '',
) {
  return transformMarkup(xhtml(inner, head), XHTML, opts(o), ctx, env);
}

/** 只开清理：不转换，看 R0、R1、R2 本身 */
export function clean(inner: string, pdfReflow: boolean, o: Partial<ConvertOptions> = {}) {
  return run(inner, { convert: false, horizontal: false, ...o }, { pdfReflow });
}

export function runTrace(inner: string, o: Partial<ConvertOptions> = {}, ctx: BookContext = { pdfReflow: false }) {
  const events: TraceEvent[] = [];
  const r = transformMarkup(xhtml(inner), XHTML, opts(o), ctx, env, (e) => events.push(e));
  return { ...r, events };
}

/** 取 <body> 内部的 markup（去掉外壳，方便断言） */
export function bodyOf(markup: string): string {
  const m = /<body[^>]*>([\s\S]*)<\/body>/.exec(markup);
  return m ? m[1]! : markup;
}

/** 去标签后的纯文本 */
export function textOf(markup: string): string {
  return markup.replace(/<[^>]*>/g, '');
}
