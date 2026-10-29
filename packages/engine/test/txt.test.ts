import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { decodeText, splitChapters } from '../src/index';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../fixtures/txt/${name}`, import.meta.url)), 'utf8');

const HANS =
  '小镇的清晨安静而明亮，街边的铺子陆续开门。邮差骑着单车穿过广场，面包店飘出热腾腾的香气。孩子们安静排队。小猫也趴在窗台上晒太阳。\r\n' +
  '我在这里住了很长时间，认识了许多邻居，也学到了不少手艺。后来我搬到了海边，开始了新的生活。\r\n';
const HANT =
  '小鎮的清晨安靜而明亮，街邊的鋪子陸續開門。郵差騎著單車穿過廣場，麵包店飄出熱騰騰的香氣。孩子們安靜排隊。小貓也趴在窗台上曬太陽。\r\n' +
  '我在這裡住了很長時間，認識了許多鄰居，也學到了不少手藝。後來我搬到了海邊，開始了新的生活。\r\n';

const bytes = (b: Buffer): Uint8Array => new Uint8Array(b);

describe('decodeText：编码识别', () => {
  it('UTF-8（无 BOM）', () => {
    const r = decodeText(bytes(Buffer.from(HANS, 'utf8')));
    expect(r.encoding).toBe('utf-8');
    expect(r.text).toBe(HANS);
  });

  it('UTF-8 带 BOM：BOM 被去掉', () => {
    const r = decodeText(bytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(HANT, 'utf8')])));
    expect(r.encoding).toBe('utf-8');
    expect(r.text).toBe(HANT);
    expect(r.text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('UTF-16LE 带 BOM', () => {
    const r = decodeText(bytes(iconv.encode(HANT, 'utf16le', { addBOM: true })));
    expect(r.encoding).toBe('utf-16le');
    expect(r.text).toBe(HANT);
  });

  it('UTF-16BE 带 BOM', () => {
    const r = decodeText(bytes(iconv.encode(HANS, 'utf16-be', { addBOM: true })));
    expect(r.encoding).toBe('utf-16be');
    expect(r.text).toBe(HANS);
  });

  it('UTF-16LE 无 BOM（ASCII 为主，靠 NUL 字节判断）', () => {
    const text = 'Chapter 1\r\nHello, this is a plain english text with a little 中文.\r\n'.repeat(5);
    const r = decodeText(bytes(iconv.encode(text, 'utf16le')));
    expect(r.encoding).toBe('utf-16le');
    expect(r.text).toBe(text);
  });

  it('UTF-16BE 无 BOM', () => {
    const text = 'Chapter 1\r\nHello, this is a plain english text with a little 中文.\r\n'.repeat(5);
    const r = decodeText(bytes(iconv.encode(text, 'utf16-be')));
    expect(r.encoding).toBe('utf-16be');
    expect(r.text).toBe(text);
  });

  it('GB18030（简体）', () => {
    const r = decodeText(bytes(iconv.encode(HANS, 'gb18030')));
    expect(r.encoding).toBe('gb18030');
    expect(r.text).toBe(HANS);
  });

  it('GBK 编码的简体也能认', () => {
    const r = decodeText(bytes(iconv.encode(HANS, 'gbk')));
    expect(r.encoding).toBe('gb18030');
    expect(r.text).toBe(HANS);
  });

  it('Big5（繁体）', () => {
    const r = decodeText(bytes(iconv.encode(HANT, 'big5')));
    expect(r.encoding).toBe('big5');
    expect(r.text).toBe(HANT);
  });

  it('Big5 与 GB18030 互不混淆：同一批句子用两种编码', () => {
    const lines = [
      '我們今天去公園玩，大家都很高興，天氣好得不得了。',
      '他說：「這個問題很難回答，但我會試試看。」',
      '請把檔案存到硬碟裡面，然後關閉電腦。',
      '歷史上的許多事件都與經濟有關，這是不爭的事實。',
    ];
    for (const l of lines) {
      const r = decodeText(bytes(iconv.encode(l, 'big5')));
      expect(r.encoding, l).toBe('big5');
      expect(r.text, l).toBe(l);
    }
    const hans = [
      '我们今天去公园玩，大家都很高兴，天气好得不得了。',
      '他说：“这个问题很难回答，但我会试试看。”',
      '请把文件存到硬盘里面，然后关闭电脑。',
      '历史上的许多事件都与经济有关，这是不争的事实。',
    ];
    for (const l of hans) {
      const r = decodeText(bytes(iconv.encode(l, 'gb18030')));
      expect(r.encoding, l).toBe('gb18030');
      expect(r.text, l).toBe(l);
    }
  });

  it('纯 ASCII 当 UTF-8', () => {
    const r = decodeText(bytes(Buffer.from('Hello, world!\r\n')));
    expect(r.encoding).toBe('utf-8');
    expect(r.text).toBe('Hello, world!\r\n');
  });

  it('空文件', () => {
    const r = decodeText(new Uint8Array(0));
    expect(r.text).toBe('');
    expect(r.encoding).toBe('utf-8');
  });

  it('GB18030 里夹杂四字节字（生僻字）', () => {
    const text = '这是一个生僻字：\u{20BB7}，后面还有一些普通的汉字用来帮助判断编码。';
    const r = decodeText(bytes(iconv.encode(text, 'gb18030')));
    expect(r.encoding).toBe('gb18030');
    expect(r.text).toBe(text);
  });

  it('不能把 UTF-8 误判成别的编码', () => {
    for (const t of [HANS, HANT, '混合 mixed 文本 with English 和 numbers 123']) {
      expect(decodeText(bytes(Buffer.from(t, 'utf8'))).encoding).toBe('utf-8');
    }
  });
});

describe('splitChapters', () => {
  it('识别 序章 / 第X章 / 第X回 / Chapter N / 后记，丢掉空行并去掉缩进', () => {
    const chapters = splitChapters(fixture('chapters-hant.txt'));
    expect(chapters.map((c) => c.title)).toEqual([
      '前言',
      '內容簡介',
      '序章',
      '第一章 山城歲月',
      '第二章 海港歲月',
      '第十二回 風雲再起',
      'Chapter 3 The English Title',
      '後記',
    ]);
    expect(chapters[0]!.paragraphs).toEqual(['燈塔日記（節選）', '作者：測試作者']);
    expect(chapters[2]!.paragraphs).toEqual(['這是序章的第一段。', '這是序章的第二段。']);
    expect(chapters[3]!.paragraphs).toHaveLength(3);
    expect(chapters[3]!.paragraphs[0]).toBe('三十出頭，我搬到山城教書，一切都讓人耳目一新。');
    expect(chapters.every((c) => c.paragraphs.every((p) => p === p.trim() && p.length > 0))).toBe(true);
  });

  it('“第一章裡我提到……。”这种正文句子不是标题', () => {
    const chapters = splitChapters(fixture('chapters-hant.txt'));
    const c = chapters.find((x) => x.title.startsWith('第二章'))!;
    expect(c.paragraphs).toHaveLength(2);
    expect(c.paragraphs[1]!.startsWith('第一章裡我提到')).toBe(true);
  });

  it('CRLF、CR、LF 混用', () => {
    const text = '第一章 甲\r\n正文一\r正文二\n第二章 乙\r\n正文三';
    const c = splitChapters(text);
    expect(c.map((x) => x.title)).toEqual(['第一章 甲', '第二章 乙']);
    expect(c[0]!.paragraphs).toEqual(['正文一', '正文二']);
  });

  it('没有标题：每约 2 万字切一章', () => {
    const para = '这是一个用来填充长度的普通段落，没有任何章节标记，里面也没有第几章之类的字样。'; // 约 38 字
    const n = 1500;
    const text = Array.from({ length: n }, () => para).join('\n');
    const chapters = splitChapters(text);
    const total = chapters.reduce((a, c) => a + c.paragraphs.join('').length, 0);
    expect(total).toBe(para.length * n);
    expect(chapters.length).toBe(Math.ceil((para.length * n) / 20000));
    for (const c of chapters.slice(0, -1)) {
      const len = c.paragraphs.join('').length;
      expect(len).toBeGreaterThanOrEqual(20000);
      expect(len).toBeLessThan(20000 + para.length);
    }
    expect(chapters[0]!.title).toBe('第1部分');
    expect(chapters[1]!.title).toBe('第2部分');
  });

  it('没有标题的短文本只有一章', () => {
    const c = splitChapters(fixture('no-chapters-hans.txt'));
    expect(c).toHaveLength(1);
    expect(c[0]!.paragraphs).toHaveLength(3);
  });

  it('目录页里一排只有标题没有正文的“第X章”会被丢掉', () => {
    const text = '目录\n第一章 甲\n第二章 乙\n第三章 丙\n第一章 甲\n正文甲。\n第二章 乙\n正文乙。\n第三章 丙\n正文丙。';
    const c = splitChapters(text);
    expect(c.map((x) => x.title)).toEqual(['前言', '第一章 甲', '第二章 乙', '第三章 丙']);
    expect(c[1]!.paragraphs).toEqual(['正文甲。']);
  });

  it('太长的行、带句号的行不当标题', () => {
    const long = '第一章' + '很'.repeat(60);
    const c = splitChapters(`${long}\n正文\n第二章 他說了很多話。\n正文二`);
    expect(c).toHaveLength(1);
    expect(c[0]!.paragraphs).toHaveLength(4);
  });

  it('阿拉伯数字与全角数字的章号', () => {
    const c = splitChapters('第1章 A\n正文\n第２章 B\n正文\n第10节 C\n正文');
    expect(c.map((x) => x.title)).toEqual(['第1章 A', '第２章 B', '第10节 C']);
  });

  it('空文本', () => {
    expect(splitChapters('')).toEqual([]);
    expect(splitChapters('\n\n  \n')).toEqual([]);
  });

  it('开头的 BOM 被忽略', () => {
    const c = splitChapters('\uFEFF第一章 甲\n正文');
    expect(c[0]!.title).toBe('第一章 甲');
  });

  it('端到端：字节 → 文本 → 章节', () => {
    const src = fixture('chapters-hant.txt');
    for (const enc of ['utf8', 'big5', 'gb18030', 'utf16le'] as const) {
      const buf = enc === 'utf8' ? Buffer.from(src, 'utf8') : iconv.encode(src, enc, { addBOM: enc === 'utf16le' });
      const { text } = decodeText(bytes(buf as Buffer));
      const chapters = splitChapters(text);
      expect(chapters.map((c) => c.title)).toContain('第一章 山城歲月');
    }
  });
});
