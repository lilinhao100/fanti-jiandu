import { describe, expect, it } from 'vitest';
import { cleanTitle, pickAuthors, pickLanguage, pickTitle } from './meta';

describe('元数据取值', () => {
  it('title：字符串、language map、空', () => {
    expect(pickTitle('燈塔日記')).toBe('燈塔日記');
    expect(pickTitle({ 'zh-Hant': '燈塔日記', en: 'Lighthouse' })).toBe('燈塔日記');
    expect(pickTitle(undefined)).toBe('');
    expect(pickTitle('  书名 ')).toBe('书名');
  });

  it('author：字符串数组、{name} 数组、language map 里的 name', () => {
    expect(pickAuthors(['林長風', '某某'])).toEqual(['林長風', '某某']);
    expect(pickAuthors([{ name: 'Zhao', sortAs: 'Zhao' }])).toEqual(['Zhao']);
    expect(pickAuthors([{ name: { zh: '作者' } }, ''])).toEqual(['作者']);
    expect(pickAuthors('单个作者')).toEqual(['单个作者']);
    expect(pickAuthors(null)).toEqual([]);
  });

  it('language：字符串或数组', () => {
    expect(pickLanguage(['zh-TW', 'en'])).toBe('zh-TW');
    expect(pickLanguage('zh')).toBe('zh');
    expect(pickLanguage(undefined)).toBe('');
  });
});

describe('cleanTitle：去掉版本说明后缀', () => {
  it('英文后缀：不区分大小写、下划线、空格', () => {
    expect(cleanTitle('燈塔日記 (Traditional Chinese Edition)')).toBe('燈塔日記');
    expect(cleanTitle('燈塔日記: 晨霧、潮汐與遠方的來信 (Traditional_chinese Edition)')).toBe('燈塔日記: 晨霧、潮汐與遠方的來信');
    expect(cleanTitle('星图 (SIMPLIFIED CHINESE EDITION)')).toBe('星图');
    expect(cleanTitle('Plain Notes (Chinese Edition)')).toBe('Plain Notes');
  });

  it('中文后缀：全角、半角括号都行', () => {
    expect(cleanTitle('日常練習（繁體中文版）')).toBe('日常練習');
    expect(cleanTitle('日常練習(繁體版)')).toBe('日常練習');
    expect(cleanTitle('日常练习（繁体中文版）')).toBe('日常练习');
    expect(cleanTitle('日常練習 【繁體中文版】')).toBe('日常練習');
  });

  it('全角字母、全角括号', () => {
    expect(cleanTitle('書名（Ｔｒａｄｉｔｉｏｎａｌ　Ｃｈｉｎｅｓｅ　Ｅｄｉｔｉｏｎ）')).toBe('書名');
  });

  it('不该动的：中间的括号、别的括号后缀、只有后缀时保留原样', () => {
    expect(cleanTitle('书名（上）')).toBe('书名（上）');
    expect(cleanTitle('A (Chinese Edition) 第二部')).toBe('A (Chinese Edition) 第二部');
    expect(cleanTitle('Sapiens (Illustrated Edition)')).toBe('Sapiens (Illustrated Edition)');
    expect(cleanTitle('(Traditional Chinese Edition)')).toBe('(Traditional Chinese Edition)');
    expect(cleanTitle('')).toBe('');
  });
});
