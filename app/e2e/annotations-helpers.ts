// M2c e2e 公共步骤：在正文里选字、读高亮的状态、直接读写 IndexedDB 里的标注
import { expect, type Page } from '@playwright/test';

export type HlDebug = { id: string; text: string; start: number; located: boolean; index: number };

/** 在当前章节正文里选中 needle（必须在同一个文本节点里），并像鼠标抬起那样触发一次，让选区菜单弹出 */
export async function selectText(page: Page, needle: string): Promise<void> {
  await page.evaluate((needle) => {
    const c = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!;
    const doc = c.doc;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.nodeValue ?? '').indexOf(needle);
      if (i < 0) continue;
      const r = doc.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + needle.length);
      const sel = doc.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
      doc.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return;
    }
    throw new Error(`正文里找不到：${needle}`);
  }, needle);
}

/** 用真实的鼠标拖选 needle（起点在第一个字左边，终点在最后一个字右边）。needle 必须在同一行里 */
export async function dragSelect(page: Page, needle: string): Promise<void> {
  const box = await page.evaluate((needle) => {
    const c = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!;
    const doc = c.doc;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.nodeValue ?? '').indexOf(needle);
      if (i < 0) continue;
      const first = doc.createRange();
      first.setStart(n, i);
      first.setEnd(n, i + 1);
      const last = doc.createRange();
      last.setStart(n, i + needle.length - 1);
      last.setEnd(n, i + needle.length);
      const a = first.getBoundingClientRect();
      const b = last.getBoundingClientRect();
      const fr = (doc.defaultView!.frameElement as HTMLElement).getBoundingClientRect();
      return { x1: fr.left + a.left + 1, y1: fr.top + a.top + a.height / 2, x2: fr.left + b.right - 1, y2: fr.top + b.top + b.height / 2 };
    }
    throw new Error(`正文里找不到：${needle}`);
  }, needle);
  await page.mouse.move(box.x1, box.y1);
  await page.mouse.down();
  await page.mouse.move((box.x1 + box.x2) / 2, box.y2, { steps: 4 });
  await page.mouse.move(box.x2, box.y2, { steps: 4 });
  await page.mouse.up();
}

export function highlightDebug(page: Page): Promise<HlDebug[]> {
  return page.evaluate(() => window.__fjd!.controller.highlightDebug());
}

/** 等当前章节里的高亮都画出来（有页面文字的才算，别的章节的只有定位信息），并核对页面上的文字 */
export async function expectHighlights(page: Page, texts: string[]): Promise<HlDebug[]> {
  const drawn = async (): Promise<HlDebug[]> => (await highlightDebug(page)).filter((h) => h.located && h.text !== '');
  await expect.poll(async () => (await drawn()).length, { timeout: 15_000 }).toBe(texts.length);
  const got = await drawn();
  expect(got.map((h) => h.text.replace(/\s+/g, '')).sort()).toEqual(texts.map((t) => t.replace(/\s+/g, '')).sort());
  return got;
}

/** 当前章节覆盖层里画了几条高亮（g[data-hl]），按样式 */
export function drawnHighlights(page: Page): Promise<{ id: string; style: string; rects: number }[]> {
  return page.evaluate(() => {
    const ov = window.__fjd!.controller.debug.view!.renderer.getContents()[0]?.overlayer as unknown as { element: SVGElement } | undefined;
    if (!ov) return [];
    return Array.from(ov.element.querySelectorAll('g[data-hl]')).map((g) => ({
      id: g.getAttribute('data-hl')!,
      style: g.getAttribute('data-style')!,
      rects: g.querySelectorAll('rect').length,
    }));
  });
}

/** 第 i 条高亮的第一个色块在视口里的位置（点击用） */
export function highlightPoint(page: Page, index = 0): Promise<{ x: number; y: number }> {
  return page.evaluate((index) => {
    const ov = window.__fjd!.controller.debug.view!.renderer.getContents()[0]!.overlayer as unknown as { element: SVGElement };
    const g = ov.element.querySelectorAll('g[data-hl]')[index]!;
    const r = g.querySelector('rect')!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, index);
}

/** 直接读 IndexedDB 里某本书的标注（kv 里 annotations:<id>） */
export function readAnnotations(page: Page): Promise<{ id: string; data: { bookmarks: unknown[]; highlights: Record<string, unknown>[] } }[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('fjd');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('kv', 'readonly');
    const store = tx.objectStore('kv');
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const r = store.getAllKeys();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const out: { id: string; data: never }[] = [];
    for (const k of keys) {
      if (typeof k !== 'string' || !k.startsWith('annotations:')) continue;
      const data = await new Promise<never>((resolve, reject) => {
        const r = store.get(k);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      out.push({ id: k.slice('annotations:'.length), data });
    }
    db.close();
    return out;
  });
}

/** 改写 IndexedDB 里的标注（造“换了版本之后找不到”“CFI 失效”之类的存档）。改完要 reload 才生效 */
export function patchHighlights(page: Page, fn: (hs: Record<string, unknown>[]) => Record<string, unknown>[]): Promise<void> {
  const src = fn.toString();
  return page.evaluate(
    async ({ src }) => {
      const patch = new Function(`return (${src})`)() as (hs: Record<string, unknown>[]) => Record<string, unknown>[];
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('fjd');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const r = store.getAllKeys();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      for (const k of keys) {
        if (typeof k !== 'string' || !k.startsWith('annotations:')) continue;
        const data = await new Promise<{ highlights: Record<string, unknown>[] }>((resolve, reject) => {
          const r = store.get(k);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        store.put({ ...data, highlights: patch(data.highlights) }, k);
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { src },
  );
}
