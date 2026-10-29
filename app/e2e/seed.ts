// 验收用的合成书库：8 本合成 epub（6 本带封面，2 本没有）+ fixtures 里的 1 本 fb2。截图和布局测试共用。
import type { Page } from '@playwright/test';
import { buildEpub, drawCover, type CoverSpec } from './epubs';
import { bookPath, importBooks, waitForCards, type PickedFile } from './helpers';

export interface Fixture {
  title: string;
  author: string;
  cover?: Omit<CoverSpec, 'title' | 'author'>;
  /** 书名放进封面图的字（默认同书名） */
  coverTitle?: string;
}

export const BOOKS: Fixture[] = [
  { title: '星圖', author: '林曉雲', cover: { w: 400, h: 600, bg: ['#0b1d3a', '#02060f'], fg: '#f2f2f2', accent: '#3a7bd5', style: 'circle', serif: true } },
  { title: '雲端漫步', author: '黃立言', cover: { w: 400, h: 600, bg: ['#f4e3c1', '#d9b77c'], fg: '#4a2b12', accent: '#b5562b', style: 'band', serif: true } },
  { title: '舊鐘樓', author: '陳雅文', cover: { w: 400, h: 600, bg: ['#1f6f5c', '#0d3b32'], fg: '#fdf3d0', accent: '#e8b04a', style: 'stripes', serif: true } },
  { title: '風信子', author: '周明遠', cover: { w: 400, h: 560, bg: ['#e9e9ee', '#bfc3cf'], fg: '#1c1c28', accent: '#8a1c2b', style: 'frame', serif: true } },
  { title: '日常練習 (Traditional Chinese Edition)', author: 'Jane Doe', coverTitle: '日常練習', cover: { w: 400, h: 640, bg: ['#ffd84a', '#f5a623'], fg: '#1a1a1a', accent: '#1a1a1a', style: 'band' } },
  { title: '紙上風景', author: '吳靜', cover: { w: 400, h: 600, bg: ['#ffffff', '#ececec'], fg: '#111111', accent: '#e60023', style: 'circle' } },
  { title: '小王子', author: '安東尼·聖修伯里' },
  { title: '紅樓夢', author: '曹雪芹' },
];

/** 造 8 本合成书 + 1 本 fixtures 里的 fb2，导入书库。返回导入后书库里的卡片数 */
export async function seedLibrary(page: Page): Promise<number> {
  const files: PickedFile[] = [];
  for (const b of BOOKS) {
    const cover = b.cover ? await drawCover(page, { ...b.cover, title: b.coverTitle ?? b.title, author: b.author }) : undefined;
    const bytes = buildEpub({ title: b.title, author: b.author, cover });
    files.push({ name: `${b.title.slice(0, 6)}.epub`, mimeType: 'application/epub+zip', buffer: Buffer.from(bytes) });
  }
  files.push(bookPath('tw-sample.fb2'));
  await importBooks(page, files);
  await waitForCards(page, BOOKS.length + 1);
  return BOOKS.length + 1;
}
