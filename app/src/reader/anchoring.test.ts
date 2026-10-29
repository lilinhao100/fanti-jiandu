import { describe, expect, it } from 'vitest';
import { buildKeyIndex, collapseSpace, contextOf, foldString, locateInIndex, makeFold, trimSpan } from './anchoring';

const fold = makeFold('tw');

/** 在 chapter 里找 q，返回找到的原文片段 */
function find(chapter: string, q: { text: string; prefix?: string; suffix?: string }): { got: string; how: string } | null {
  const span = locateInIndex(buildKeyIndex(chapter, fold), { text: q.text, prefix: q.prefix ?? '', suffix: q.suffix ?? '' }, fold);
  return span ? { got: chapter.slice(span.start, span.end), how: span.how } : null;
}

describe('折叠', () => {
  it('繁体、简体、「」与“”折成同一串；空白丢掉', () => {
    expect(foldString('搭船來到江南', fold)).toBe(foldString('搭船来到江南', fold));
    expect(foldString('他說：「好」', fold)).toBe(foldString('他说：“好”', fold));
    expect(foldString(' 搭 船\n来到　江南 ', fold)).toBe('搭船来到江南');
    expect(foldString('乾淨', fold)).toBe(foldString('干净', fold));
  });

  it('键与原文的对应：丢掉的空白不占位，辅助平面的字占两个下标', () => {
    const idx = buildKeyIndex('a b𠀀c', fold);
    expect(idx.key).toBe('ab𠀀c');
    // key 里第 3 个字（𠀀 的低位代理）对应原文 [3,5)
    expect(idx.start[3]).toBe(3);
    expect(idx.end[3]).toBe(5);
  });
});

describe('locateInIndex', () => {
  const chapterTw = '那年春天，我隨著父親搭船來到江南，一路上都在下雨。父親很少說話，只是靜靜地望著窗外。\n\n    老街的石板路被雨水磨得發亮，每走一步，都能聽見鞋底與石頭輕輕摩擦的聲音。';
  const chapterSc = '那年春天，我随着父亲搭船来到江南，一路上都在下雨。父亲很少说话，只是静静地望着窗外。老街的石板路被雨水磨得发亮，每走一步，都能听见鞋底与石头轻轻摩擦的声音。';

  it('同一模式：整段命中，返回原文偏移', () => {
    const r = find(chapterSc, { text: '搭船来到江南' });
    expect(r).toEqual({ got: '搭船来到江南', how: 'exact' });
  });

  it('简体里存的，在繁体原文里找得到（跨模式）；反过来也行', () => {
    expect(find(chapterTw, { text: '搭船来到江南' })).toEqual({ got: '搭船來到江南', how: 'exact' });
    expect(find(chapterSc, { text: '搭船來到江南' })).toEqual({ got: '搭船来到江南', how: 'exact' });
  });

  it('排版清理把段落合并、空格删了：照样找得到，偏移指向原文', () => {
    // 繁体原文里“窗外。”和“老街”之间隔着空行和缩进；简体里是连着的
    const r = find(chapterTw, { text: '窗外。老街的石板路' });
    expect(r?.got.replace(/\s+/g, '')).toBe('窗外。老街的石板路');
    expect(r?.how).toBe('exact');
  });

  it('同一句出现多次：用 prefix、suffix 挑对的那一处', () => {
    const chapter = '他说好。她点头。他说好。她摇头。他说好。她没有回答。';
    const second = find(chapter, { text: '他说好', prefix: '她点头。', suffix: '。她摇头' });
    expect(second).not.toBeNull();
    const idx = buildKeyIndex(chapter, fold);
    const span = locateInIndex(idx, { text: '他说好', prefix: '她点头。', suffix: '。她摇头' }, fold)!;
    expect(chapter.slice(span.start - 4, span.start)).toBe('她点头。');
    const third = locateInIndex(idx, { text: '他说好', prefix: '她摇头。', suffix: '。她没有' }, fold)!;
    expect(chapter.slice(third.start - 4, third.start)).toBe('她摇头。');
  });

  it('词汇替换改了字数（軟體→软件 也算同字数；程式→程序；滑鼠→鼠标）：靠两端锚点近似找到', () => {
    // 原文（繁体）：软件开发者  存档（简体，词汇层转过）：「软件」→ 文字里的 “資訊→信息” 之类字数相同，这里造一个字数变化的例子
    const tw = '前文前文前文這是一段關於滑鼠與鍵盤的說明文字，後文後文後文';
    const saved = { text: '这是一段关于鼠标与键盘的说明文字', prefix: '前文前文前文', suffix: '，后文后文后文' };
    const r = find(tw, saved);
    expect(r).not.toBeNull();
    expect(r!.got.startsWith('這是一段關於')).toBe(true);
    expect(r!.got.endsWith('說明文字')).toBe(true);
  });

  it('短文字被词汇替换改过：靠前后文锚点找到', () => {
    const tw = '他打開了軟體，然後關掉電腦。';
    // 存档里是“软件”（简体），原文里是“軟體”：折叠后是“软体”，字数相同但不等
    const r = find(tw, { text: '软件', prefix: '他打开了', suffix: '，然后关掉电脑' });
    expect(r?.got).toBe('軟體');
    expect(r?.how).toBe('near');
  });

  it('书里已经没有这句话：返回 null，不乱找', () => {
    expect(find(chapterSc, { text: '这句话书里根本没有', prefix: '不存在的前文', suffix: '不存在的后文' })).toBeNull();
    expect(find(chapterSc, { text: '' })).toBeNull();
  });
});

describe('contextOf / trimSpan / collapseSpace', () => {
  it('上下文各 32 字，空白压缩后再取', () => {
    const text = `${'前'.repeat(50)}\n\n   目标文字${'后'.repeat(50)}`;
    const start = text.indexOf('目标');
    const { prefix, suffix } = contextOf(text, start, start + 4);
    expect(prefix.length).toBe(32);
    expect(prefix.endsWith(' ')).toBe(true);
    expect(suffix).toBe('后'.repeat(32));
  });

  it('trimSpan 收紧两头的空白；全是空白返回 null', () => {
    expect(trimSpan('  ab  ', 0, 6)).toEqual({ start: 2, end: 4 });
    expect(trimSpan(' \n\t', 0, 3)).toBeNull();
  });

  it('collapseSpace', () => {
    expect(collapseSpace('a \n\t b')).toBe('a b');
  });
});
