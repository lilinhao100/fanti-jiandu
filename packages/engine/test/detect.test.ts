import { describe, expect, it } from 'vitest';
import { detectPdfReflow, detectScript } from '../src/index';

const HANT =
  '燈塔日記：一個守塔人的海邊歲月。我出生在海邊的小村莊，從城裡往南大約三小時車程。我父母都是漁民。父親在燈塔工作，負責維護港口的燈光系統。';
const HANS =
  '灯塔日记：一个守塔人的海边岁月。我出生在海边的小村庄，从城里往南大约三小时车程。我父母都是渔民。父亲在灯塔工作，负责维护港口的灯光系统。';

describe('detectScript', () => {
  it('繁体文本判 hant，置信度高', () => {
    const r = detectScript(HANT);
    expect(r.script).toBe('hant');
    expect(r.confidence).toBeGreaterThan(0.8);
    expect(r.variant).toBe('tw');
  });

  it('简体文本判 hans', () => {
    const r = detectScript(HANS);
    expect(r.script).toBe('hans');
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it('繁简各半判 mixed', () => {
    const r = detectScript(HANT + HANS);
    expect(r.script).toBe('mixed');
  });

  it('没有汉字判 none', () => {
    expect(detectScript('Hello, world 123 !').script).toBe('none');
    expect(detectScript('').script).toBe('none');
    expect(detectScript('こんにちは').script).toBe('none');
    expect(detectScript('').confidence).toBe(0);
  });

  it('langHint：zh-HK、zh-MO 取 hk；zh-TW、zh-Hant、空取 tw', () => {
    expect(detectScript(HANT, 'zh-HK').variant).toBe('hk');
    expect(detectScript(HANT, 'zh-hk').variant).toBe('hk');
    expect(detectScript(HANT, 'zh_HK').variant).toBe('hk');
    expect(detectScript(HANT, 'zh-MO').variant).toBe('hk');
    expect(detectScript(HANT, 'zh-TW').variant).toBe('tw');
    expect(detectScript(HANT, 'zh-Hant').variant).toBe('tw');
    expect(detectScript(HANT, '').variant).toBe('tw');
    expect(detectScript(HANT, undefined).variant).toBe('tw');
    expect(detectScript(HANT, 'zh').variant).toBe('tw');
  });

  it('langHint 不影响 script 判断', () => {
    expect(detectScript(HANS, 'zh-TW').script).toBe('hans');
    expect(detectScript(HANT, 'zh-CN').script).toBe('hant');
  });

  it('两种文字共用的“著 里 后 台 干”不拖累判断', () => {
    // 简体文本里的 著作、台湾、干部、里面、后来 都不应该被算成繁体证据
    const hans = '这部著作讲述了台湾的干部在里面工作，后来他们离开了。' + '我们今天去公园玩，大家都很高兴。';
    expect(detectScript(hans).script).toBe('hans');
    const hant = '這部著作講述了台灣的幹部在裡面工作，後來他們離開了。' + '我們今天去公園玩，大家都很高興。';
    expect(detectScript(hant).script).toBe('hant');
  });

  it('只有两种文字共用的字时，置信度很低', () => {
    const r = detectScript('我你他的一是不人');
    expect(r.confidence).toBeLessThanOrEqual(0.1);
  });

  it('证据太少时压低置信度', () => {
    const few = detectScript('幣');
    const many = detectScript(HANT);
    expect(few.script).toBe('hant');
    expect(few.confidence).toBeLessThan(many.confidence);
  });

  it('夹杂英文、数字、标点不影响', () => {
    const r = detectScript('Chapter 1: ' + HANT + ' (2024) https://example.com');
    expect(r.script).toBe('hant');
  });
});

const para = (t: string) => `<p class="c">${t}</p>`;
const page = (body: string, head = '') =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title>${head}</head><body>${body}</body></html>`;

describe('detectPdfReflow', () => {
  it('meta generator 含 PDF Reflow（属性顺序任意）', () => {
    expect(detectPdfReflow([page('', '<meta content="PDF Reflow conversion" name="generator"/>')])).toBe(true);
    expect(detectPdfReflow([page('', '<meta name="generator" content="PDF Reflow conversion"/>')])).toBe(true);
    expect(detectPdfReflow([page('', "<meta name='generator' content='PDF Reflow v2'/>")])).toBe(true);
  });

  it('head 里有 pdftohtml 或 ABBYY', () => {
    expect(detectPdfReflow([page('', '<meta name="generator" content="pdftohtml 0.40"/>')])).toBe(true);
    expect(detectPdfReflow([page('', '<meta name="producer" content="ABBYY FineReader"/>')])).toBe(true);
  });

  it('只要有一章命中即可', () => {
    const plain = page(para('正文内容。'));
    const hit = page('', '<meta name="generator" content="PDF Reflow conversion"/>');
    expect(detectPdfReflow([plain, plain, hit])).toBe(true);
  });

  it('calibre 等普通生成器不算', () => {
    expect(detectPdfReflow([page(para('正常的段落。'), '<meta name="generator" content="calibre 8.10"/>')])).toBe(false);
  });

  it('body 里提到 pdftohtml 不算（只看 head）', () => {
    expect(detectPdfReflow([page(para('这个工具叫 pdftohtml，很好用。'))])).toBe(false);
  });

  it('统计法：汉字间有空格的段落占比 ≥ 15% 且总数 ≥ 30', () => {
    const spaced = para('我 們 在 一 起 工 作 很 久 了 。'); // 9 处
    const normal = para('我们在一起工作很久了。');
    const body = spaced.repeat(4) + normal.repeat(10); // 4/14 ≈ 29%，36 处
    expect(detectPdfReflow([page(body)])).toBe(true);
  });

  it('统计法：总数不到 30 处不算', () => {
    const body = para('我 們 在 一 起。').repeat(5) + para('正常。').repeat(5); // 5 * 4 = 20 处
    expect(detectPdfReflow([page(body)])).toBe(false);
  });

  it('统计法：占比不到 15% 不算', () => {
    const spaced = para('我 們 在 一 起 工 作 很 久 了 。'); // 9 处
    const normal = para('我们在一起工作很久了。');
    const body = spaced.repeat(4) + normal.repeat(40); // 4/44 ≈ 9%，36 处
    expect(detectPdfReflow([page(body)])).toBe(false);
  });

  it('汉字与英文、数字之间的空格不算', () => {
    const body = para('我用 Windows 11 和 macOS 15 工作很久了。').repeat(50);
    expect(detectPdfReflow([page(body)])).toBe(false);
  });

  it('跨标签的空格也能识别，NBSP 实体也算', () => {
    const body = para('<span>我 </span><span>們 </span>在&#160;一&nbsp;起 工 作 。').repeat(10);
    expect(detectPdfReflow([page(body)])).toBe(true);
  });

  it('空输入、没有汉字的输入', () => {
    expect(detectPdfReflow([])).toBe(false);
    expect(detectPdfReflow([page(para('English only text with some words'))])).toBe(false);
  });
});
