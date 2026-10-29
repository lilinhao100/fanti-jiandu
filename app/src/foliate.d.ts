// vendor/foliate-js 的模块声明（Vite 别名 foliate-js → ../vendor/foliate-js）
declare module 'foliate-js/view.js' {
  export function makeBook(file: File | string): Promise<import('./reader/foliateTypes').FoliateBook>;
  export class View extends HTMLElement {}
}

declare module 'foliate-js/paginator.js' {
  export class Paginator extends HTMLElement {}
}

declare module 'foliate-js/epubcfi.js' {
  export const isCFI: RegExp;
  export function parse(cfi: string): unknown;
  export function collapse(cfi: string, toEnd?: boolean): string;
  export function compare(a: string, b: string): number;
}

declare module 'foliate-js/overlayer.js' {
  export class Overlayer {
    static highlight(rects: Iterable<DOMRect>, options?: { color?: string }): SVGGElement;
    static outline(rects: Iterable<DOMRect>, options?: { color?: string; width?: number; radius?: number }): SVGGElement;
    static underline(rects: Iterable<DOMRect>, options?: { color?: string; width?: number; writingMode?: string }): SVGGElement;
  }
}
