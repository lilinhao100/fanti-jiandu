import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');
export const BOOKS = path.join(ROOT, 'fixtures', 'books');
export const bookPath = (name: string): string => path.join(BOOKS, name);

/** 控制器暴露在 window.__fjd 上（Reader 组件挂载时设置），测试直接读 foliate 的状态 */
type Fjd = {
  controller: {
    debug: {
      view: {
        lastLocation: { cfi: string; fraction: number } | null;
        book: { sections: { createDocument?: () => Promise<Document> }[] };
        renderer: {
          getContents(): { index: number; doc: Document; overlayer?: unknown }[];
          page: number;
          pages: number;
        };
        goTo(t: number | string): Promise<unknown>;
      } | null;
      options: Record<string, unknown> | null;
    };
    search(q: string): Promise<{ label: string; cfi: string; excerpt: { match: string } }[]>;
    toggleDisplay(): Promise<void>;
    highlightDebug(): { id: string; text: string; start: number; located: boolean; index: number }[];
  };
};
declare global {
  interface Window {
    __fjd?: Fjd;
  }
}

/** 选择器接受的文件：磁盘路径，或内存里的文件 */
export type PickedFile = string | { name: string; mimeType: string; buffer: Buffer | Uint8Array };

/** 在书库里点“添加图书”，用真实的文件选择器导入 */
export async function importBooks(page: Page, files: PickedFile[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  const empty = page.getByTestId('empty-library');
  if (await empty.isVisible().catch(() => false)) {
    await empty.getByRole('button', { name: '添加图书' }).click();
  } else {
    await page.getByTestId('more-button').click();
    await page.getByRole('menuitem', { name: /添加图书/ }).click();
  }
  // Playwright 不允许路径和内存文件混着传：混着时把路径也读成内存文件
  const mixed = files.some((f) => typeof f !== 'string');
  await (await chooser).setFiles(
    mixed
      ? files.map((f) =>
          typeof f === 'string'
            ? { name: path.basename(f), mimeType: 'application/octet-stream', buffer: fs.readFileSync(f) }
            : { name: f.name, mimeType: f.mimeType, buffer: Buffer.from(f.buffer) },
        )
      : (files as string[]),
  );
}

export async function waitForCards(page: Page, n: number): Promise<void> {
  await expect(page.getByTestId('book-card')).toHaveCount(n, { timeout: 60_000 });
}

/** 点开书库里第 index 张封面，等阅读器就绪 */
export async function openCard(page: Page, nameLike: RegExp | string): Promise<void> {
  await page.getByRole('button', { name: nameLike }).click();
  await waitReaderReady(page);
}

export async function waitReaderReady(page: Page): Promise<void> {
  await expect(page.getByTestId('reader')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
  // 切换繁简、打开时都会盖一层 loading，等它消失
  await expect(page.getByTestId('reader-loading')).toHaveCount(0);
}

/** 当前加载在 iframe 里的那一章的正文文本 */
export function currentSectionText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = window.__fjd!.controller.debug.view!.renderer.getContents()[0];
    return c ? (c.doc.body.textContent ?? '') : '';
  });
}

export function currentLocation(page: Page): Promise<{ cfi: string; fraction: number; section: number } | null> {
  return page.evaluate(() => {
    const v = window.__fjd?.controller.debug.view;
    const loc = v?.lastLocation;
    if (!v || !loc) return null;
    return { cfi: loc.cfi, fraction: loc.fraction, section: v.renderer.getContents()[0]?.index ?? -1 };
  });
}

/** 取每一章经 createDocument（书内搜索读的那份文本）转换后的纯文本 */
export function searchableTexts(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const sections = window.__fjd!.controller.debug.view!.book.sections;
    const out: string[] = [];
    for (const s of sections) {
      if (!s.createDocument) {
        out.push('');
        continue;
      }
      const doc = await s.createDocument();
      out.push(doc.body?.textContent ?? '');
    }
    return out;
  });
}

export async function gotoSection(page: Page, index: number): Promise<void> {
  await page.evaluate((i) => window.__fjd!.controller.debug.view!.goTo(i), index);
  await expect.poll(async () => (await currentLocation(page))?.section).toBe(index);
}

/** 去掉所有空白，方便断言跨节点的句子 */
export const squash = (s: string): string => s.replace(/\s+/g, '');

/** 有一页翻页动画（约 300ms）+ 100ms 锁，翻页后等位置真的变了 */
export async function expectLocationChange(page: Page, action: () => Promise<void>): Promise<void> {
  const before = await currentLocation(page);
  await action();
  await expect.poll(async () => (await currentLocation(page))?.cfi, { timeout: 10_000 }).not.toBe(before?.cfi);
  // foliate 翻页后还锁 100ms（paginator.js:1069），马上再按会被丢弃；真实用户不会快过这个
  await page.waitForTimeout(250);
}

/** 直接改 IndexedDB 里某本书的记录（验收截图要造“读到一半”“读完了”的状态）。改完要 reload 页面才会显示 */
export function patchBook(page: Page, titleLike: string, patch: Record<string, unknown>): Promise<void> {
  return page.evaluate(
    async ({ titleLike, patch }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('fjd');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction('books', 'readwrite');
      const store = tx.objectStore('books');
      const all = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const r = store.getAll();
        r.onsuccess = () => resolve(r.result as Record<string, unknown>[]);
        r.onerror = () => reject(r.error);
      });
      const hit = all.find((b) => String(b.title).includes(titleLike));
      if (!hit) throw new Error(`找不到书：${titleLike}`);
      store.put({ ...hit, ...patch });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { titleLike, patch },
  );
}
