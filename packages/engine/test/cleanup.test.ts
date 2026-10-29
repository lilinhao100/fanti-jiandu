import { describe, expect, it } from 'vitest';
import { bodyOf, clean, IDEO_SPACE, NBSP, run, runTrace, textOf, xhtml } from './env';

/** 一段 ≥ 20 字、以汉字结尾的前半段 */
const LONG_A = '小鎮的清晨安靜而明亮街邊的鋪子陸續開門郵差騎著單車穿過廣場所以我總愛在窗邊看這座小鎮醒來';
const longA = (tail = '') => LONG_A + tail;

/* ================================================================ R0 */
describe('R0：汉字之间含换行的空白（所有书，cleanup 开即执行）', () => {
  it('该改的：汉字\\n汉字', () => {
    const r = clean('<p>我們在這\n裡等你</p>', false);
    expect(bodyOf(r.markup)).toBe('<p>我們在這裡等你</p>');
    expect(r.stats.newlinesRemoved).toBe(1);
  });

  it('该改的：折行带缩进空格、制表符、CRLF', () => {
    const r = clean('<p>我們在這  \r\n\t  裡等你</p>', false);
    expect(bodyOf(r.markup)).toBe('<p>我們在這裡等你</p>');
  });

  it('该改的：连续多个换行', () => {
    const r = clean('<p>我們在這\n\n\n裡等你</p>', false);
    expect(bodyOf(r.markup)).toBe('<p>我們在這裡等你</p>');
  });

  it('该改的：全角标点两侧', () => {
    const r = clean('<p>他說：\n「你好」。\n再見</p>', false);
    expect(bodyOf(r.markup)).toBe('<p>他說：「你好」。再見</p>');
  });

  it('该改的：跨行内标签的换行', () => {
    const r = clean('<p><span>我們在這\n</span><b>裡</b>等你</p>', false);
    expect(bodyOf(r.markup)).toBe('<p><span>我們在這</span><b>裡</b>等你</p>');
  });

  it('该改的：纯简体书也一样（R0 不依赖繁简）', () => {
    const r = clean('<p>我们在这\n里等你</p>', false);
    expect(bodyOf(r.markup)).toBe('<p>我们在这里等你</p>');
  });

  it('不该改的：普通书里汉字间的单个空格（R1 才管，且只限 PDF 转制）', () => {
    const r = clean('<p>我們 在這裡</p>', false);
    expect(r.markup).toContain('我們 在這裡');
    expect(r.stats.spacesRemoved).toBe(0);
  });

  it('不该改的：汉字与拉丁字母之间的换行', () => {
    const r = clean('<p>我用\nWindows\n工作</p>', false);
    expect(bodyOf(r.markup)).toBe('<p>我用\nWindows\n工作</p>');
  });

  it('不该改的：英文单词之间的换行', () => {
    const r = clean('<p>hello\nworld</p>', false);
    expect(r.markup).toBe(clean('<p>hello\nworld</p>', false).markup);
    expect(bodyOf(r.markup)).toBe('<p>hello\nworld</p>');
  });

  it('不该改的：<br/> 两侧（诗歌的行）', () => {
    const html = '<p>床前明月光，\n<br/>\n疑是地上霜。</p>';
    expect(clean(html, false).markup).toBe(xhtml(html)); // 没有任何改动：原样返回
  });

  it('不该改的：块与块之间的空白、段首段尾换行', () => {
    const html = '\n<p>\n第一段。\n</p>\n<p>\n第二段。\n</p>\n';
    const r = clean(html, false);
    expect(bodyOf(r.markup)).toBe(html);
  });

  it('不该改的：<pre> 与 <code> 里面', () => {
    const html = '<pre>漢字\n漢字</pre><p>用<code>漢字\n漢字</code>表示</p>';
    const r = clean(html, false);
    expect(r.markup).toContain('<pre>漢字\n漢字</pre>');
    expect(r.markup).toContain('<code>漢字\n漢字</code>');
  });

  it('不该改的：两个块之间（不同段落）', () => {
    const html = '<p>第一段結束</p>\n<p>第二段開始</p>';
    expect(bodyOf(clean(html, false).markup)).toBe(html);
  });

  it('cleanup 关掉：不动', () => {
    const r = clean('<p>我們在這\n裡等你</p>', false, { cleanup: false });
    expect(r.markup).toContain('這\n裡');
  });
});

/* ================================================================ R1 */
describe('R1：汉字之间的 ASCII 空格和 NBSP（只限 pdfReflow）', () => {
  it('该改的：单个空格', () => {
    const r = clean('<p>二 十出頭，在山城工作</p>', true);
    expect(bodyOf(r.markup)).toBe('<p>二十出頭，在山城工作</p>');
    expect(r.stats.spacesRemoved).toBe(1);
  });

  it('该改的：1 到 3 个空格、NBSP 混合', () => {
    const r = clean(`<p>我 們  在   這${NBSP}裡${NBSP}${NBSP}等你</p>`, true);
    expect(bodyOf(r.markup)).toBe('<p>我們在這裡等你</p>');
    expect(r.stats.spacesRemoved).toBe(1 + 2 + 3 + 1 + 2);
  });

  it('该改的：跨节点（<span>我 </span>非常）', () => {
    const r = clean('<p><span>我 </span>非常<b>高 </b><i>興</i></p>', true);
    expect(bodyOf(r.markup)).toBe('<p><span>我</span>非常<b>高</b><i>興</i></p>');
  });

  it('该改的：全角标点与汉字之间', () => {
    const r = clean('<p>他說： 「你好」 。 再見</p>', true);
    expect(bodyOf(r.markup)).toBe('<p>他說：「你好」。再見</p>');
  });

  it('该改的：R0 和 R1 同时出现', () => {
    const r = clean('<p>所 有的門\n都自動 開啓</p>', true);
    expect(bodyOf(r.markup)).toBe('<p>所有的門都自動開啓</p>');
    expect(r.stats.spacesRemoved).toBe(2);
    expect(r.stats.newlinesRemoved).toBe(1);
  });

  it('不该改的：不是 PDF 转制时 R1 不执行', () => {
    const r = clean('<p>二 十出頭</p>', false);
    expect(bodyOf(r.markup)).toBe('<p>二 十出頭</p>');
  });

  it('不该改的：汉字与拉丁字母、数字之间的空格', () => {
    const html = '<p>我用 Windows 11 和 macOS 15 工作，版本 2 更好，共 3 章</p>';
    expect(bodyOf(clean(html, true).markup)).toBe(html);
  });

  it('不该改的：4 个及以上的空格（表格对齐）', () => {
    const html = '<p>法定貨幣    黃金</p>';
    expect(bodyOf(clean(html, true).markup)).toBe(html);
  });

  it('不该改的：全角空格 U+3000（首行缩进、人名）', () => {
    const html = `<p>${IDEO_SPACE}${IDEO_SPACE}我們出發了。</p><p>李${IDEO_SPACE}白</p>`;
    const r = clean(html, true);
    expect(bodyOf(r.markup)).toBe(html);
  });

  it('不该改的：ASCII 逗号后的空格（逗号不是全角标点）', () => {
    const html = '<p>好, 世界</p>';
    expect(bodyOf(clean(html, true).markup)).toBe(html);
  });

  it('不该改的：英文单词之间', () => {
    const html = '<p>the quick brown fox</p>';
    expect(bodyOf(clean(html, true).markup)).toBe(html);
  });

  it('不该改的：<br/> 把空格隔开（诗歌）', () => {
    const html = '<p>春眠不覺曉 <br/> 處處聞啼鳥</p>';
    expect(clean(html, true).markup).toBe(xhtml(html));
  });

  it('不该改的：块边界两侧（一个块末尾的空格不会碰到下一个块的汉字）', () => {
    const html = '<div>我們 <p>你們</p> 他們</div>';
    expect(bodyOf(clean(html, true).markup)).toBe(html);
  });

  it('不该改的：code、pre、kbd、samp、var 里的空格', () => {
    const html = '<p>用<code>漢 字</code>和<kbd>你 好</kbd>以及<samp>是 的</samp>與<var>未 知</var></p><pre>代 碼</pre>';
    expect(bodyOf(clean(html, true).markup)).toBe(html);
  });

  it('不该改的：对话、诗歌的短行、署名（没有汉字间空格的内容原样）', () => {
    const html = '<p>「你好嗎？」</p><p>「很好。」</p><p>床前明月光</p><p>疑是地上霜</p><p>——某某敬上</p>';
    expect(clean(html, true).markup).toBe(xhtml(html));
  });

  it('标题里汉字间的空格在 PDF 转制书里同样去掉（“第 一 章”→“第一章”）', () => {
    const r = clean('<h1>第 一 章</h1>', true);
    expect(bodyOf(r.markup)).toBe('<h1>第一章</h1>');
  });

  it('cleanup 关掉：R1 也不执行', () => {
    const r = clean('<p>二 十出頭</p>', true, { cleanup: false });
    expect(bodyOf(r.markup)).toBe('<p>二 十出頭</p>');
  });
});

/* ================================================================ R2 */
describe('R2：合并在分页处被截断的相邻 <p>', () => {
  const merge = (inner: string, o = {}) => clean(inner, true, o);

  it('该改的：基本合并', () => {
    const r = merge(`<p class="c">${longA('的')}</p><p class="c">孩子們安靜排隊。</p>`);
    expect(bodyOf(r.markup)).toBe(`<p class="c">${longA('的')}孩子們安靜排隊。</p>`);
    expect(r.stats.paragraphsMerged).toBe(1);
  });

  it('该改的：链式合并三段', () => {
    const r = merge(
      `<p>${longA('的')}</p><p>${longA('的')}</p><p>${longA('的')}</p><p>孩子們安靜排隊。</p>`,
    );
    expect(r.stats.paragraphsMerged).toBe(3);
    expect(bodyOf(r.markup)).toBe(`<p>${longA('的').repeat(3)}孩子們安靜排隊。</p>`);
  });

  it('该改的：B 以拉丁字母/数字加汉字开头', () => {
    expect(merge(`<p>${longA('的')}</p><p>Sam把我的書單加長了。</p>`).stats.paragraphsMerged).toBe(1);
    expect(merge(`<p>${longA('的')}</p><p>2014年5月，我們重逢。</p>`).stats.paragraphsMerged).toBe(1);
  });

  it('该改的：A 末尾带空白、B 开头带空白，接缝处不留空格', () => {
    const r = merge(`<p>${longA('的')} </p>\n<p> 孩子們安靜排隊。</p>`);
    expect(r.stats.paragraphsMerged).toBe(1);
    expect(textOf(bodyOf(r.markup))).toContain('的孩子們安靜排隊');
  });

  it('该改的：B 的 id 变成接缝处的空 <span id>，A 的 id 保留', () => {
    const r = merge(`<p id="a1" class="c">${longA('的')}</p><p id="page_7" class="c">孩子們安靜排隊。</p>`);
    expect(r.stats.paragraphsMerged).toBe(1);
    const out = bodyOf(r.markup);
    expect(out).toContain('<p id="a1" class="c">');
    expect(out).toContain('<span id="page_7" />');
    expect(out.indexOf('<span id="page_7"')).toBeGreaterThan(out.indexOf('的</span>') - 1);
    expect(out.match(/<p /g)?.length).toBe(1);
    // 锚点在两半文字之间
    expect(out).toMatch(/的<span id="page_7" \/>孩子們安靜排隊。<\/p>/);
  });

  it('该改的：链式合并时每个被合并段落的 id 都保留', () => {
    const r = merge(`<p>${longA('的')}</p><p id="x1">${longA('的')}</p><p id="x2">孩子們安靜排隊。</p>`);
    const out = bodyOf(r.markup);
    expect(r.stats.paragraphsMerged).toBe(2);
    expect(out).toContain('id="x1"');
    expect(out).toContain('id="x2"');
  });

  it('该改的：A 以行内标签结尾、B 以行内标签开头', () => {
    const r = merge(`<p><span>${longA('的')}</span></p><p><span>孩子們安靜排隊。</span></p>`);
    expect(r.stats.paragraphsMerged).toBe(1);
    expect(bodyOf(r.markup)).toBe(`<p><span>${longA('的')}</span><span>孩子們安靜排隊。</span></p>`);
  });

  it('该改的：A、B 之间只有空白和注释', () => {
    const r = merge(`<p>${longA('的')}</p>\n  <!-- page break -->\n<p>孩子們安靜排隊。</p>`);
    expect(r.stats.paragraphsMerged).toBe(1);
  });

  it('该改的：嵌在 div 里的段落', () => {
    const r = merge(`<div><div><p>${longA('的')}</p><p>孩子們安靜排隊。</p></div></div>`);
    expect(r.stats.paragraphsMerged).toBe(1);
  });

  it('该改的：接缝两边的词在同一个块里一起转换（軟｜體 → 软件）', () => {
    const r = run(`<p>${longA('的軟')}</p><p>體工程師很多。</p>`, { horizontal: false }, { pdfReflow: true });
    expect(r.stats.paragraphsMerged).toBe(1);
    expect(textOf(bodyOf(r.markup))).toContain('软件工程师很多');
  });

  it('trace：R2 事件', () => {
    const t = runTrace(`<p>${longA('的')}</p><p>孩子們安靜排隊。</p>`, { convert: false, horizontal: false }, { pdfReflow: true });
    const ev = t.events.filter((e) => e.rule === 'R2');
    expect(ev.length).toBe(1);
    expect(ev[0]!.prefix.endsWith('的')).toBe(true);
    expect(ev[0]!.suffix.startsWith('孩子')).toBe(true);
  });

  /* ---- 不该改的 ---- */
  const notMerged = (inner: string, why: string) =>
    it(`不该改的：${why}`, () => {
      const r = merge(inner);
      expect(r.stats.paragraphsMerged).toBe(0);
      expect(bodyOf(r.markup).match(/<p[ >]/g)?.length).toBe(inner.match(/<p[ >]/g)?.length);
    });

  notMerged(`<p class="a">${longA('的')}</p><p class="b">孩子們安靜排隊。</p>`, 'class 不同');
  notMerged(`<p class="a">${longA('的')}</p><p>孩子們安靜排隊。</p>`, 'A 有 class、B 没有');
  notMerged(`<p style="text-align:center">${longA('的')}</p><p>孩子們安靜排隊。</p>`, 'style 不同');
  notMerged(`<p>短短一句話的</p><p>孩子們安靜排隊。</p>`, 'A 太短（< 20 字）');
  notMerged(`<p>${longA('。')}</p><p>孩子們安靜排隊。</p>`, 'A 以句号结尾');
  notMerged(`<p>${longA('，')}</p><p>孩子們安靜排隊。</p>`, 'A 以逗号结尾');
  notMerged(`<p>${longA('」')}</p><p>孩子們安靜排隊。</p>`, 'A 以引号结尾');
  notMerged(`<p>${longA('的')}</p><p>「你好。」</p>`, 'B 以「开头（对话）');
  notMerged(`<p>${longA('的')}</p><p>“你好。”</p>`, 'B 以“开头');
  notMerged(`<p>${longA('的')}</p><p>（注：這是補充）</p>`, 'B 以（开头');
  notMerged(`<p>${longA('的')}</p><p>《燈塔日記》是一本書。</p>`, 'B 以《开头');
  notMerged(`<p>${longA('的')}</p><p>【重點】這是重點。</p>`, 'B 以【开头');
  notMerged(`<p>${longA('的')}</p><p>● 第一點是這樣的。</p>`, 'B 以项目符号 ● 开头');
  notMerged(`<p>${longA('的')}</p><p>• 第一點是這樣的。</p>`, 'B 以项目符号 • 开头');
  notMerged(`<p>${longA('的')}</p><p>- 第一點是這樣的。</p>`, 'B 以 - 开头');
  notMerged(`<p>${longA('的')}</p><p>第三章 新的開始</p>`, 'B 是“第…章”');
  notMerged(`<p>${longA('的')}</p><p>第12節 新的開始</p>`, 'B 是“第…节”');
  notMerged(`<p>${longA('的')}</p><p>第 十 回 新的開始</p>`, 'B 是“第 十 回”');
  notMerged(`<p>${longA('的')}</p><p>一、總則如下</p>`, 'B 是“一、”编号');
  notMerged(`<p>${longA('的')}</p><p>3. 這是列表項</p>`, 'B 以数字加点开头');
  notMerged(`<p>${longA('的')}</p><p>Hello world 你好</p>`, 'B 以英文单词加空格开头');
  notMerged(`<p>${longA('的')}</p><p>12345</p>`, 'B 以纯数字开头');
  notMerged(`<h2>${longA('的')}</h2><h2>孩子們安靜排隊。</h2>`, 'h2');
  notMerged(`<ul><li><p>${longA('的')}</p><p>孩子們安靜排隊。</p></li></ul>`, 'li 里面');
  notMerged(`<table><tr><td><p>${longA('的')}</p><p>孩子們安靜排隊。</p></td></tr></table>`, 'td 里面');
  notMerged(`<blockquote><p>${longA('的')}</p><p>孩子們安靜排隊。</p></blockquote>`, 'blockquote 里面');
  notMerged(`<figure><p>${longA('的')}</p><p>孩子們安靜排隊。</p></figure>`, 'figure 里面');
  notMerged(`<p>${longA('的')}</p><hr/><p>孩子們安靜排隊。</p>`, '中间隔着 hr');
  notMerged(`<p>${longA('的')}</p><div>隔開</div><p>孩子們安靜排隊。</p>`, '中间隔着别的元素');
  notMerged(`<p>${longA('的')}</p>散落的文字<p>孩子們安靜排隊。</p>`, '中间有非空文本');
  notMerged(`<p>${longA('的')}<br/></p><p>孩子們安靜排隊。</p>`, 'A 以 <br/> 结尾');
  notMerged(`<p>${longA('的')}<img src="a.jpg"/></p><p>孩子們安靜排隊。</p>`, 'A 以图片结尾');
  notMerged(`<p>${longA('的')}</p><p><img src="a.jpg"/>孩子們安靜排隊。</p>`, 'B 以图片开头');
  notMerged(`<p>${longA('的')}</p><p>${IDEO_SPACE}${IDEO_SPACE}孩子們安靜排隊。</p>`, 'B 有全角空格首行缩进');
  notMerged(`<p>${longA('的')}</p><p>  孩子們安靜排隊。</p>`, 'B 有两个以上空格的缩进');
  notMerged(
    `<p>床前明月光，疑是地上霜，舉頭望明月，低頭思故鄉，春眠不覺曉處處聞啼鳥夜來風雨聲花落知多少</p><p>孩子們安靜排隊。</p>`.replace('少', '少。'),
    '诗歌（以句号结尾）',
  );
  notMerged(`<p>床前明月光</p><p>疑是地上霜</p><p>舉頭望明月</p><p>低頭思故鄉</p>`, '诗歌短行');
  notMerged(`<p>——某某敬上</p><p>二〇二四年冬日記</p>`, '署名');
  notMerged(`<p>${'一二三四五六七八九十'.repeat(3)} 法定貨幣 黃金</p><p>發行方 無</p>`, '最后一行太短：表格行、小标题粘在段尾');
  notMerged(
    `<p><span><a href="a.html#p1">燈塔啟用，2017 年 7 月 14 日 12 點</a></span></p><p><span><a href="a.html#p2">早年歲月</a></span></p>`,
    '目录条目（整行是链接）',
  );
  notMerged(`<p>${longA('的')}</p><p>${'a'.repeat(10)}</p>`, 'B 开头不是汉字');

  it('不该改的：pdfReflow 为假时不合并', () => {
    const r = clean(`<p>${longA('的')}</p><p>孩子們安靜排隊。</p>`, false);
    expect(r.stats.paragraphsMerged).toBe(0);
    expect(bodyOf(r.markup).match(/<p>/g)?.length).toBe(2);
  });

  it('不该改的：cleanup 关掉时不合并', () => {
    const r = clean(`<p>${longA('的')}</p><p>孩子們安靜排隊。</p>`, true, { cleanup: false });
    expect(r.stats.paragraphsMerged).toBe(0);
  });

  it('A 的“最后一行”只有一个很长的词时（无空格）仍可合并', () => {
    // 没有空格 = 没有“行”的概念，不应误触“最后一行太短”的保护
    const r = merge(`<p>${'汉'.repeat(30)}</p><p>字繼續。</p>`);
    expect(r.stats.paragraphsMerged).toBe(1);
  });
});
