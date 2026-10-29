import { describe, expect, it } from 'vitest';
import { storedBookName } from './tauri';
import { getPlatform, isTauriRuntime } from './index';

describe('storedBookName', () => {
  it('普通格式沿用原文件的小写扩展名', () => {
    expect(storedBookName({ id: 'abc', format: 'epub', fileName: '书.EPUB' })).toBe('abc.epub');
    expect(storedBookName({ id: 'abc', format: 'azw3', fileName: 'x.azw' })).toBe('abc.azw');
    expect(storedBookName({ id: 'abc', format: 'fb2', fileName: 'x.fb2' })).toBe('abc.fb2');
  });
  it('txt 导入时已转成 epub', () => {
    expect(storedBookName({ id: 'abc', format: 'txt', fileName: '小说.txt' })).toBe('abc.epub');
  });
  it('文件名没有扩展名时退回格式名', () => {
    expect(storedBookName({ id: 'abc', format: 'mobi', fileName: 'noext' })).toBe('abc.mobi');
  });
});

describe('平台选择', () => {
  it('不在 Tauri 里时用 web 实现', () => {
    expect(isTauriRuntime()).toBe(false);
  });
  it('getPlatform 取得 web 平台', () => {
    expect(getPlatform().kind).toBe('web');
  });
});
