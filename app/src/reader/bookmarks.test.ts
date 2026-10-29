import { describe, expect, it } from 'vitest';
import type { Bookmark } from '../model';
import { isOnPage, pageBookmarks } from './bookmarks';

const bm = (id: string, cfi: string): Bookmark => ({ id, cfi, label: id, createdAt: 0 });

describe('isOnPage', () => {
  // 页面范围 CFI：第 4 个 spine 项，/4/2/1:0 到 /4/10/1:20
  const page = 'epubcfi(/6/8!/4,/2/1:0,/10/1:20)';

  it('书签起点落在页面范围内：算有书签', () => {
    expect(isOnPage('epubcfi(/6/8!/4,/2/1:0,/10/1:20)', page)).toBe(true); // 同一页
    expect(isOnPage('epubcfi(/6/8!/4/6/1:3)', page)).toBe(true); // 页中间
    expect(isOnPage('epubcfi(/6/8!/4,/6/1:3,/6/1:9)', page)).toBe(true); // 范围形式，取起点
  });

  it('字号变了以后，旧页面起点落在新页面范围内也算', () => {
    const newPage = 'epubcfi(/6/8!/4,/2/1:0,/6/1:50)';
    expect(isOnPage('epubcfi(/6/8!/4/4/1:10)', newPage)).toBe(true);
    expect(isOnPage('epubcfi(/6/8!/4/8/1:10)', newPage)).toBe(false);
  });

  it('终点是开区间：恰好落在终点上的书签属于下一页', () => {
    expect(isOnPage('epubcfi(/6/8!/4/10/1:20)', page)).toBe(false);
  });

  it('别的章节、别的页：没有', () => {
    expect(isOnPage('epubcfi(/6/10!/4/2/1:5)', page)).toBe(false);
    expect(isOnPage('epubcfi(/6/6!/4/12/1:5)', page)).toBe(false);
    expect(isOnPage('epubcfi(/6/8!/4/12/1:5)', page)).toBe(false);
  });

  it('pageBookmarks 只取当前页的', () => {
    const list = [bm('a', 'epubcfi(/6/8!/4/6/1:3)'), bm('b', 'epubcfi(/6/10!/4/2/1:5)')];
    expect(pageBookmarks(list, page).map((b) => b.id)).toEqual(['a']);
  });
});
