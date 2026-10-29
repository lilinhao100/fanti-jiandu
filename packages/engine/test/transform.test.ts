import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, transformDocument, transformMarkup } from '../src/index';
import { bodyOf, env, opts, run, runTrace, textOf, XHTML, xhtml } from './env';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../fixtures/xhtml/${name}`, import.meta.url)), 'utf8');

describe('按块转换', () => {
  it('词语被行内标签切开时，按块拼接后整体转换（軟<b>體</b> → 软件）', () => {
    const r = run('<p>這個軟<b>體</b>很好</p>');
    expect(bodyOf(r.markup)).toBe('<p>这个软<b>件</b>很好</p>');
    expect(r.stats.convertedChars).toBeGreaterThan(0);
  });

  it('多层嵌套的行内标签', () => {
    const r = run('<p><span>網</span><em><b>路</b></em>連線</p>');
    expect(textOf(bodyOf(r.markup))).toBe('网络连接');
  });

  it('块边界不拼接：<div>軟<p>體</p></div> 里的“軟”和“體”分别转换', () => {
    const r = run('<div>軟<p>體</p></div>');
    expect(textOf(bodyOf(r.markup))).toBe('软体');
  });

  it('<br/> 是边界：软｜体 不会连成词', () => {
    const r = run('<p>軟<br/>體</p>');
    expect(textOf(bodyOf(r.markup))).toBe('软体');
  });

  it('列表、表格、标题、引用、图注都是块', () => {
    const r = run(
      '<ul><li>軟</li><li>體</li></ul><table><tr><td>軟</td><td>體</td></tr></table><h1>軟</h1><h2>體</h2><blockquote>軟</blockquote><p>體</p>',
    );
    expect(textOf(bodyOf(r.markup))).toBe('软体软体软体软体');
  });

  it('长度变化时退回逐节点转换（辅助平面字变成基本平面字）', () => {
    const odd = String.fromCodePoint(0x21ed5); // 𡻕 → 岁，UTF-16 长度 2 → 1
    const r = run(`<p>${odd}月，<b>燈</b>塔</p>`);
    expect(textOf(bodyOf(r.markup))).toBe('岁月，灯塔');
  });

  it('PDF 转制书里被空格切开的词：先清理空格，再整体转换（回 覆 → 回复，軟 體 → 软件）', () => {
    const r = run('<p>他回 覆了，用<b>軟 </b>體處理</p>', {}, { pdfReflow: true });
    expect(textOf(bodyOf(r.markup))).toBe('他回复了，用软件处理');
    expect(r.stats.spacesRemoved).toBe(2);
    // 不是 PDF 转制时空格不动，词也就切不开
    const n = run('<p>他回 覆了</p>', {}, { pdfReflow: false });
    expect(textOf(bodyOf(n.markup))).toBe('他回 覆了');
  });

  it('文本节点含实体、CDATA 之外的字符：&amp; &lt; 保持转义', () => {
    const r = run('<p>幣 &amp; 軟體 &lt; 網路</p>');
    expect(bodyOf(r.markup)).toBe('<p>币 &amp; 软件 &lt; 网络</p>');
  });
});

describe('跳过的元素', () => {
  const skip = ['script', 'style', 'code', 'pre', 'kbd', 'samp', 'var'];
  for (const tag of skip) {
    it(`<${tag}> 内部不转换，旁边照常转换`, () => {
      const r = run(`<p>幣<${tag}>幣軟體</${tag}>幣</p>`);
      expect(bodyOf(r.markup)).toBe(`<p>币<${tag}>幣軟體</${tag}>币</p>`);
    });
  }

  it('math 与 svg 内部不转换', () => {
    const r = run(
      '<p>幣</p><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>幣</mi></math><svg xmlns="http://www.w3.org/2000/svg"><text>幣</text></svg>',
    );
    expect(r.markup).toContain('<mi>幣</mi>');
    expect(r.markup).toContain('<text>幣</text>');
    expect(r.markup).toContain('<p>币</p>');
  });

  it('被跳过的元素把前后的文字隔开（用<code>x</code>軟 体）', () => {
    const r = run('<p>軟<code>x</code>體</p>');
    expect(textOf(bodyOf(r.markup))).toBe('软x体');
  });
});

describe('属性与 <title>', () => {
  it('alt、title 属性转换', () => {
    const r = run('<p><img src="a.jpg" alt="燈塔圖" title="軟體"/><a href="#x" title="網路">鏈結</a></p>');
    expect(r.markup).toContain('alt="灯塔图"');
    expect(r.markup).toContain('title="软件"');
    expect(r.markup).toContain('title="网络"');
  });

  it('其他属性不动（href、class、id、src、data-*）', () => {
    const html = '<p id="幣" class="軟體" data-x="網路"><a href="幣.html#網路">幣</a><img src="圖.jpg" alt=""/></p>';
    const r = run(html);
    expect(r.markup).toContain('id="幣"');
    expect(r.markup).toContain('class="軟體"');
    expect(r.markup).toContain('data-x="網路"');
    expect(r.markup).toContain('href="幣.html#網路"');
    expect(r.markup).toContain('src="圖.jpg"');
  });

  it('<title> 转换', () => {
    const r = transformMarkup(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>燈塔日記</title></head><body><p>x</p></body></html>',
      XHTML,
      opts(),
      { pdfReflow: false },
      env,
    );
    expect(r.markup).toContain('<title>灯塔日记</title>');
  });
});

describe('XHTML 序列化', () => {
  it('保留 XML 声明、命名空间、自闭合标签', () => {
    const src =
      "<?xml version='1.0' encoding='utf-8'?>\n" +
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh">' +
      '<head><title>t</title><link rel="stylesheet" href="a.css"/></head>' +
      '<body><p epub:type="x">幣<br/><img src="a.jpg" alt=""/></p><div></div></body></html>';
    const r = transformMarkup(src, XHTML, opts(), { pdfReflow: false }, env);
    expect(r.markup.startsWith("<?xml version='1.0' encoding='utf-8'?>\n<html")).toBe(true);
    expect(r.markup).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(r.markup).toContain('xmlns:epub="http://www.idpf.org/2007/ops"');
    expect(r.markup).toContain('xml:lang="zh"');
    expect(r.markup).toContain('epub:type="x"');
    expect(r.markup).toMatch(/<br ?\/>/);
    expect(r.markup).toMatch(/<img [^>]*\/>/);
    expect(r.markup).toMatch(/<link [^>]*\/>/);
    expect(r.markup).toContain('币');
  });

  it('输出能被再次解析，并且再转一遍没有变化（幂等）', () => {
    const once = run('<p>燈塔「軟體」</p><p>第二段</p>');
    const twice = transformMarkup(once.markup, XHTML, opts(), { pdfReflow: false }, env);
    expect(twice.markup).toBe(once.markup);
  });

  it('没有任何改动时原样返回输入（逐字节相同）', () => {
    const src = xhtml('<p>这是简体中文，没有需要转换的内容。</p>');
    const r = transformMarkup(src, XHTML, opts(), { pdfReflow: false }, env);
    expect(r.markup).toBe(src);
    expect(r.stats).toEqual({ convertedChars: 0, spacesRemoved: 0, paragraphsMerged: 0, newlinesRemoved: 0 });
  });

  it('所有选项都关：原样返回', () => {
    const src = xhtml('<p>幣</p>');
    const r = transformMarkup(src, XHTML, opts({ convert: false, cleanup: false, horizontal: false }), { pdfReflow: true }, env);
    expect(r.markup).toBe(src);
  });

  it('XHTML 里的 HTML 实体（&nbsp;）：走 HTML 解析，内容仍然被转换', () => {
    const src = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body><p>幣&nbsp;安</p></body></html>';
    const r = transformMarkup(src, XHTML, opts(), { pdfReflow: false }, env);
    expect(r.stats.convertedChars).toBe(1);
    expect(textOf(bodyOf(r.markup))).toContain('币');
    expect(r.markup).not.toContain('&amp;nbsp;');
  });

  it('不是 XML 的内容当 XHTML 传入：回退到 HTML 解析，不抛错', () => {
    const r = transformMarkup('<p>幣<br>安', XHTML, opts(), { pdfReflow: false }, env);
    expect(r.markup).toContain('币');
  });
});

describe('text/html', () => {
  it('HTML 文档：<br>、doctype 保持，内容被转换', () => {
    const src = '<!DOCTYPE html>\n<html><head><title>幣</title></head><body><p>幣<br>安<img src="a.jpg"></p></body></html>';
    const r = transformMarkup(src, 'text/html', opts(), { pdfReflow: false }, env);
    expect(r.markup.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(r.markup).toContain('<title>币</title>');
    expect(r.markup).toContain('币<br>安');
    expect(r.markup).not.toContain('/>');
  });

  it('HTML 文档里 R0 与 R2 同样生效', () => {
    const a = '小鎮的清晨安靜而明亮街邊的鋪子陸續開門郵差騎著單車穿過廣場所以我總愛在窗邊看這座小鎮醒來的';
    const src = `<html><body><p>${a}</p><p>孩子們安靜排隊。</p><p>我們在這\n裡等你</p></body></html>`;
    const r = transformMarkup(src, 'text/html', opts({ convert: false, horizontal: false }), { pdfReflow: true }, env);
    expect(r.stats.paragraphsMerged).toBe(1);
    expect(r.stats.newlinesRemoved).toBe(1);
  });
});

describe('transformDocument（直接传 Document）', () => {
  it('原地修改并返回统计', () => {
    const doc = new env.DOMParser().parseFromString(xhtml('<p>燈塔\n人生</p>'), XHTML);
    const stats = transformDocument(doc, DEFAULT_OPTIONS, { pdfReflow: false });
    expect(stats.convertedChars).toBe(1);
    expect(stats.newlinesRemoved).toBe(1);
    expect(String(doc)).toContain('灯塔人生');
  });
});

describe('竖排转横排', () => {
  it('style 属性与 <style> 元素里的 writing-mode', () => {
    const r = run(
      '<p style="writing-mode: vertical-rl; color: red">幣</p>',
      {},
      { pdfReflow: false },
      '<style type="text/css">html { -epub-writing-mode: vertical-rl; writing-mode: vertical-rl } .x { color: red }</style>',
    );
    expect(r.markup).toContain('style="writing-mode: horizontal-tb; color: red"');
    expect(r.markup).toContain('-epub-writing-mode: horizontal-tb; writing-mode: horizontal-tb');
    expect(r.markup).toContain('.x { color: red }');
  });

  it('horizontal 关：style 保持竖排', () => {
    const r = run('<p style="writing-mode: vertical-rl">幣</p>', { horizontal: false });
    expect(r.markup).toContain('writing-mode: vertical-rl');
  });

  it('只有竖排样式、没有可转换文字时也会改动', () => {
    const r = run('<p style="writing-mode: vertical-rl">abc</p>');
    expect(r.markup).toContain('horizontal-tb');
  });

  it('竖排标点还原', () => {
    const open = String.fromCodePoint(0xfe35);
    const close = String.fromCodePoint(0xfe36);
    const r = run(`<p>${open}注${close}</p>`);
    expect(textOf(bodyOf(r.markup))).toBe('（注）');
  });
});

describe('选项组合', () => {
  it('convert 关、cleanup 开：只做 R0', () => {
    const r = run('<p>燈塔\n人生</p>', { convert: false, horizontal: false });
    expect(bodyOf(r.markup)).toBe('<p>燈塔人生</p>');
    expect(r.stats.convertedChars).toBe(0);
    expect(r.stats.newlinesRemoved).toBe(1);
  });

  it('convert 开、cleanup 关：只转换，不碰换行', () => {
    const r = run('<p>燈塔\n人生</p>', { cleanup: false });
    expect(bodyOf(r.markup)).toBe('<p>灯塔\n人生</p>');
  });

  it('词汇层和引号开关透传到 transformMarkup', () => {
    const src = '<p>「軟體」</p>';
    expect(bodyOf(run(src).markup)).toBe('<p>“软件”</p>');
    expect(bodyOf(run(src, { vocabulary: false }).markup)).toBe('<p>“软体”</p>');
    expect(bodyOf(run(src, { quotes: false }).markup)).toBe('<p>「软件」</p>');
  });

  it('hk、t 变体', () => {
    expect(bodyOf(run('<p>軟體</p>', { variant: 'hk' }).markup)).toBe('<p>软体</p>');
    expect(bodyOf(run('<p>軟件</p>', { variant: 't' }).markup)).toBe('<p>软件</p>');
  });
});

describe('统计', () => {
  it('convertedChars 只数被改动的字符', () => {
    const r = run('<p>燈塔abc，人生</p>');
    expect(r.stats.convertedChars).toBe(1);
  });

  it('各项统计', () => {
    const a = '小鎮的清晨安靜而明亮街邊的鋪子陸續開門郵差騎著單車穿過廣場所以我總愛在窗邊看這座小鎮醒來的';
    const r = run(`<p>${a}</p><p>孩 子們安靜排隊。</p><p>我們在這\n裡</p>`, {}, { pdfReflow: true });
    expect(r.stats.paragraphsMerged).toBe(1);
    expect(r.stats.spacesRemoved).toBe(1);
    expect(r.stats.newlinesRemoved).toBe(1);
    expect(r.stats.convertedChars).toBeGreaterThan(10);
  });
});

describe('确定性', () => {
  const sources = [
    xhtml('<p>燈塔「軟體」\n人 生</p><p>第二段</p>'),
    fixture('pdf-reflow.xhtml'),
    fixture('vertical.xhtml'),
  ];
  for (const [i, src] of sources.entries()) {
    it(`同一输入转换两次，逐字节相同（#${i + 1}）`, () => {
      const a = transformMarkup(src, XHTML, opts(), { pdfReflow: true }, env);
      const b = transformMarkup(src, XHTML, opts(), { pdfReflow: true }, env);
      expect(a.markup).toBe(b.markup);
      expect(a.stats).toEqual(b.stats);
    });
  }

  it('带 trace 与不带 trace 的结果相同', () => {
    const src = fixture('pdf-reflow.xhtml');
    const plain = transformMarkup(src, XHTML, opts(), { pdfReflow: true }, env);
    const traced = transformMarkup(src, XHTML, opts(), { pdfReflow: true }, env, () => {});
    expect(traced.markup).toBe(plain.markup);
  });

  it('不同选项产生不同输出，且各自稳定', () => {
    const src = fixture('pdf-reflow.xhtml');
    const a = transformMarkup(src, XHTML, opts({ vocabulary: false }), { pdfReflow: true }, env).markup;
    const b = transformMarkup(src, XHTML, opts({ vocabulary: true }), { pdfReflow: true }, env).markup;
    expect(a).not.toBe(b);
  });
});

describe('trace', () => {
  it('转换事件分类：字形 / 词汇 / 引号', () => {
    const t = runTrace('<p>他說，燈塔的「abc」，用軟體</p>');
    const rules = new Set(t.events.map((e) => e.rule));
    expect(rules.has('char')).toBe(true);
    expect(rules.has('vocab')).toBe(true);
    expect(rules.has('quotes')).toBe(true);
    const vocab = t.events.find((e) => e.rule === 'vocab')!;
    expect(vocab.before).toContain('軟體');
    expect(vocab.after).toContain('软件');
  });

  it('R0、R1 事件', () => {
    const t = runTrace('<p>我 們\n在</p>', { convert: false, horizontal: false }, { pdfReflow: true });
    expect(t.events.map((e) => e.rule).sort()).toEqual(['R0', 'R1']);
  });
});

describe('fixtures', () => {
  it('pdf-reflow.xhtml：综合用例', () => {
    const r = transformMarkup(fixture('pdf-reflow.xhtml'), XHTML, opts(), { pdfReflow: true }, env);
    const text = textOf(bodyOf(r.markup));
    // 该改的
    expect(text).toContain('三十出头，我搬到山城教书');
    expect(text).toContain('所有的窗户都朝着山谷打开');
    expect(text).toContain('我们赢的场次比输的少');
    // 汉字与英文之间的空格保留
    expect(text).toContain('主管 Sam 很惊讶');
    expect(text).toContain('Linux 系统');
    // 全角空格缩进保留
    expect(r.markup).toContain(String.fromCodePoint(0x3000) + String.fromCodePoint(0x3000) + '缩进段落保持不变');
    // 代码里的空格保留
    expect(r.markup).toContain('<code>漢 字 不 動</code>');
    // 诗歌每行一段，不合并
    expect(r.markup).toContain('<p class="poem">床前明月光</p>');
    expect(r.markup).toContain('<p class="poem">低头思故乡</p>');
    // 页码锚点还在
    expect(r.markup).toContain('id="page_24"');
    expect(r.stats.paragraphsMerged).toBe(1);
  });

  it('plain.xhtml：普通书不被 R1、R2 误伤（pdfReflow = false）', () => {
    const src = fixture('plain.xhtml');
    const r = transformMarkup(src, XHTML, opts(), { pdfReflow: false }, env);
    expect(r.stats.spacesRemoved).toBe(0);
    expect(r.stats.paragraphsMerged).toBe(0);
    const text = textOf(bodyOf(r.markup));
    expect(text).toContain('他 说：“你好”');
    expect(text).toContain('第 1 章');
    expect(r.markup).toContain('<title>灯塔日记</title>');
    // 它是一本正常排版的繁体书，只做繁转简，段落数不变
    expect((src.match(/<p[ >]/g) ?? []).length).toBe((r.markup.match(/<p[ >]/g) ?? []).length);
  });

  it('simplified.xhtml：简体书一个字都不动', () => {
    const src = fixture('simplified.xhtml');
    const r = transformMarkup(src, XHTML, opts(), { pdfReflow: false }, env);
    expect(r.markup).toBe(src);
  });

  it('vertical.xhtml：竖排标点还原、writing-mode 改横排', () => {
    const r = transformMarkup(fixture('vertical.xhtml'), XHTML, opts(), { pdfReflow: false }, env);
    expect(r.markup).not.toMatch(/vertical-rl/);
    expect(r.markup).toContain('horizontal-tb');
    expect(textOf(bodyOf(r.markup))).toContain('“书名”');
    expect(textOf(bodyOf(r.markup))).toContain('（注）');
  });
});
