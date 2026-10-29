// 阅读窗口的 e2e 公共步骤：导入合成的繁体书并打开
import type { Page } from '@playwright/test';
import { importBooks, openCard, waitForCards } from './helpers';
import { buildReadingBook, READING_TITLE_SC } from './reading-book';

/** long：每章 60 段（约 150 个双页），翻一页只占全书进度的不到 1%，位置不跳的断言才有意义 */
export async function openReadingBook(page: Page, opts: { long?: boolean } = {}): Promise<void> {
  await page.goto('/');
  await importBooks(page, [{ name: 'reading.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(buildReadingBook(opts.long ? 60 : 14)) }]);
  await waitForCards(page, 1);
  await openCard(page, new RegExp(`打开《${READING_TITLE_SC}`));
}
