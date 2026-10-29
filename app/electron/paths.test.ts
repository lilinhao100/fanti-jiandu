import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAppFile, resolveData, resolveServed } from './paths';

const ROOT = path.resolve('C:\\data\\繁体简读');
const APP = path.resolve('C:\\app\\dist');

describe('resolveServed（fjd://data）', () => {
  it('书、封面、字体可以读', () => {
    expect(resolveServed(ROOT, '/books/abc.epub')).toBe(path.join(ROOT, 'books', 'abc.epub'));
    expect(resolveServed(ROOT, '/covers/abc.jpg')).toBe(path.join(ROOT, 'covers', 'abc.jpg'));
    expect(resolveServed(ROOT, '/fonts/x.ttf')).toBe(path.join(ROOT, 'fonts', 'x.ttf'));
  });
  it('中文文件名（百分号编码）可以读', () => {
    expect(resolveServed(ROOT, '/fonts/%E5%AE%8B%E4%BD%93.ttf')).toBe(path.join(ROOT, 'fonts', '宋体.ttf'));
  });
  it('二次编码的 ..%252f 解码一次后只是 books 里一个怪名字的文件，出不了目录', () => {
    expect(resolveServed(ROOT, '/books/..%252flibrary.json')).toBe(path.join(ROOT, 'books', '..%2flibrary.json'));
  });
  it.each([
    '/library.json',
    '/settings.json',
    '/annotations/a.json',
    '/books/../library.json',
    '/books/%2e%2e/library.json',
    '/books/..%2flibrary.json',
    '/books/..%5clibrary.json',
    '/books/C:%5Cwin.ini',
    '/books/C:/win.ini',
    '/books/a/b.epub',
    '/books/',
    '/',
    '',
    '/books/%00.epub',
    '/books/%ZZ',
    '//books/x.epub/..',
  ])('拒绝 %s', (p) => {
    expect(resolveServed(ROOT, p)).toBeNull();
  });
});

describe('resolveData（IPC）', () => {
  it('允许 JSON 和四个子目录下的文件', () => {
    expect(resolveData(ROOT, 'library.json')).toBe(path.join(ROOT, 'library.json'));
    expect(resolveData(ROOT, 'settings.json')).toBe(path.join(ROOT, 'settings.json'));
    expect(resolveData(ROOT, 'annotations/a.json')).toBe(path.join(ROOT, 'annotations', 'a.json'));
    expect(resolveData(ROOT, 'books/a.epub')).toBe(path.join(ROOT, 'books', 'a.epub'));
  });
  it.each([
    '../x.json',
    'books/../library.json',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    'books\\x',
    'shell.json',
    'window-state.json',
    'browser/Cookies',
    'books/a/b',
    '',
    '..',
  ])('拒绝 %s', (p) => {
    expect(() => resolveData(ROOT, p)).toThrow();
  });
});

describe('resolveAppFile（fjd://app）', () => {
  it('根路径给 index.html，子路径限制在界面目录内', () => {
    expect(resolveAppFile(APP, '/')).toBe(path.join(APP, 'index.html'));
    expect(resolveAppFile(APP, '/assets/a.js')).toBe(path.join(APP, 'assets', 'a.js'));
    expect(resolveAppFile(APP, '/../main.cjs')).toBeNull();
    expect(resolveAppFile(APP, '/%2e%2e/main.cjs')).toBeNull();
    expect(resolveAppFile(APP, '/assets/..%5c..%5cmain.cjs')).toBeNull();
  });
});
