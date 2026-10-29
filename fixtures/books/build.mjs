// 生成 M1 e2e 用的小书：fb2、mobi（MOBI6）、Big5 编码的 txt、azw3（KF8）。
// 用法：node fixtures/books/build.mjs
// 没有 calibre，所以 mobi 和 azw3 是自己按格式写的最小实现，够 foliate-js 打开即可（不保证兼容真实的 Kindle）。
// 输出是确定的（不含时间戳），重复运行得到相同的文件。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildAzw3 } from './build-azw3.mjs';
import { Bytes, buildPdb, esc } from './util.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Big5 编码用 iconv-lite：它是 packages/engine 的开发依赖，这里只读取，不修改 packages/
const require = createRequire(path.join(here, '../../packages/engine/package.json'));
// fflate 用 app 的依赖（packages/ 之外）
const require2 = createRequire(path.join(here, '../../app/package.json'));

/** 每本书的内容。刻意放进繁体字、台湾词汇和直角引号，转换后能一眼看出差别。 */
export const CONTENT = {
  title: '軟體與網路的故事',
  author: '王小明',
  chapters: [
    {
      title: '第一章 緣起',
      paragraphs: [
        '「你好，世界」，他說。那一年我們開發了第一套軟體，使用網路連線把資料傳到遠端。',
        '『這不是夢』，她回答。窗外的風吹過，書桌上的滑鼠還亮著燈。',
        '這是第一章的最後一段，記錄了當時的心情與回憶。',
      ],
    },
    {
      title: '第二章 結束',
      paragraphs: [
        '後來公司把伺服器搬到了雲端，我們再也不用半夜起來重新啟動機器。',
        '這本小書到這裡就結束了，謝謝你讀完它。',
      ],
    },
  ],
};

// ---------------------------------------------------------------- fb2
function buildFb2() {
  const { title, author, chapters } = CONTENT;
  const sections = chapters
    .map(
      (c) =>
        `<section><title><p>${esc(c.title)}</p></title>${c.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</section>`,
    )
    .join('\n');
  return Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info><genre>prose</genre><author><first-name>小明</first-name><last-name>王</last-name></author><book-title>${esc(title)}</book-title><lang>zh-TW</lang></title-info>
<document-info><author><nickname>fjd-fixture</nickname></author><date value="2026-10-28">2026-10-28</date><id>fjd-fixture-fb2</id><version>1.0</version></document-info>
</description>
<body>
${sections}
</body>
</FictionBook>
`,
    'utf8',
  );
}

// ---------------------------------------------------------------- Big5 txt
function buildBig5Txt() {
  const iconv = require('iconv-lite');
  const { title, author, chapters } = CONTENT;
  const lines = [title, `作者：${author}`, ''];
  for (const c of chapters) {
    lines.push(c.title, ...c.paragraphs.map((p) => `　　${p}`), '');
  }
  // Big5 里没有的字（这份内容里没有）会被 iconv 换成 ?，所以先确认能无损往返
  const text = lines.join('\r\n');
  const buf = iconv.encode(text, 'big5');
  if (iconv.decode(buf, 'big5') !== text) throw new Error('Big5 编码不能无损往返，请改用 Big5 里有的字');
  return buf;
}

// ---------------------------------------------------------------- 简体 txt（UTF-8 带 BOM）
// 本身就是简体的书：繁/简按钮应当是灰的，文字不该被改动。
function buildSimplifiedTxt() {
  const lines = ['软件与网络的故事', '作者：王小明', '', '第一章 缘起', '　　“你好，世界”，他说。那一年我们开发了第一套软件，使用网络连线把数据传到远端。', '', '第二章 结束', '　　这本小书到这里就结束了，谢谢你读完它。', ''];
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines.join('\r\n'), 'utf8')]);
}

// ---------------------------------------------------------------- MOBI6
const PAGEBREAK = '<mbp:pagebreak/>';
const pos10 = (n) => String(n).padStart(10, '0');

function buildMobi6() {
  const { title, author, chapters } = CONTENT;

  // 文本用两遍生成：filepos 是字节偏移，位数固定为 10 位，所以两遍长度不变
  const make = (tocPos, chapterPos) => {
    const toc = `<h2>目錄</h2>${chapters
      .map((c, i) => `<p><a filepos="${pos10(chapterPos[i] ?? 0)}">${esc(c.title)}</a></p>`)
      .join('')}`;
    const parts = [
      `<html><head><guide><reference type="toc" title="目錄" filepos="${pos10(tocPos)}"/></guide></head><body>` +
        `<h1>${esc(title)}</h1><p>${esc(author)}</p>`,
      toc,
      ...chapters.map((c) => `<h2>${esc(c.title)}</h2>${c.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}`),
    ];
    return { parts, text: parts.join(PAGEBREAK) + '</body></html>' };
  };

  const first = make(0, []);
  // 各部分在整段文本里的起始字节偏移（分页标记属于后一部分的开头，与 foliate 的切法一致）
  const starts = [];
  let at = 0;
  first.parts.forEach((p, i) => {
    starts.push(at);
    at += Buffer.byteLength(p) + (i < first.parts.length - 1 ? Buffer.byteLength(PAGEBREAK) : 0);
  });
  const real = make(starts[1], starts.slice(2));
  const textBuf = Buffer.from(real.text, 'utf8');

  // 文本记录：每条 4096 字节（不压缩）
  const RECORD = 4096;
  const textRecords = [];
  for (let i = 0; i < textBuf.length; i += RECORD) textRecords.push(textBuf.subarray(i, i + RECORD));

  // 记录 0：PalmDOC 头 + MOBI 头（248 字节）+ EXTH + 书名
  const exth = (() => {
    const recs = [
      [100, Buffer.from(author, 'utf8')],
      [524, Buffer.from('zh-TW', 'utf8')],
    ];
    const body = new Bytes();
    for (const [type, data] of recs) body.u32(type).u32(8 + data.length).push(data);
    let len = 12 + body.length;
    const pad = (4 - (len % 4)) % 4;
    const out = new Bytes().str('EXTH').u32(len + pad).u32(recs.length).push(body.done()).zeros(pad);
    return out.done();
  })();

  const MOBI_LEN = 248;
  const titleBuf = Buffer.from(title, 'utf8');
  const titleOffset = 16 + MOBI_LEN + exth.length;

  const rec0 = Buffer.alloc(titleOffset + titleBuf.length + 4);
  // PalmDOC 头
  rec0.writeUInt16BE(1, 0); // compression = 1（不压缩）
  rec0.writeUInt32BE(textBuf.length, 4);
  rec0.writeUInt16BE(textRecords.length, 8);
  rec0.writeUInt16BE(RECORD, 10);
  rec0.writeUInt16BE(0, 12); // encryption
  // MOBI 头
  rec0.write('MOBI', 16, 'latin1');
  rec0.writeUInt32BE(MOBI_LEN, 20);
  rec0.writeUInt32BE(2, 24); // type: book
  rec0.writeUInt32BE(65001, 28); // UTF-8
  rec0.writeUInt32BE(0x1234, 32); // uid
  rec0.writeUInt32BE(6, 36); // version 6 → MOBI6
  rec0.writeUInt32BE(titleOffset, 84);
  rec0.writeUInt32BE(titleBuf.length, 88);
  rec0.writeUInt8(1 << 2, 94); // region: zh-TW（foliate 取 region >> 2 当下标）
  rec0.writeUInt8(4, 95); // language: zh
  rec0.writeUInt32BE(textRecords.length + 1, 108); // 资源起点（没有资源）
  rec0.writeUInt32BE(0xffffffff, 112); // huffcdic
  rec0.writeUInt32BE(0, 116);
  rec0.writeUInt32BE(0x40, 128); // 有 EXTH
  rec0.writeUInt32BE(0, 240); // 没有尾部条目
  rec0.writeUInt32BE(0xffffffff, 244); // 没有索引
  exth.copy(rec0, 16 + MOBI_LEN);
  titleBuf.copy(rec0, titleOffset);

  return buildPdb('FJD_Fixture_MOBI', [rec0, ...textRecords]);
}

// ---------------------------------------------------------------- 竖排 epub
// 台湾竖排书的典型特征：样式表里 writing-mode: vertical-rl、spine 里 page-progression-direction="rtl"、竖排标点。
// 文字够长，保证分成好几页。
function buildVerticalEpub() {
  const { zipSync, strToU8 } = require2('fflate');
  const para = '這是一本直排的書﹁軟體﹂與﹁網路﹂都在文字裡，由上往下，由右往左閱讀。';
  const body = Array.from({ length: 80 }, (_, i) => `<p>${i + 1}．${para}</p>`).join('\n');
  const html = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-TW" lang="zh-TW"><head><title>直排</title>
<link rel="stylesheet" type="text/css" href="vertical.css"/>
<style type="text/css">.inline { -webkit-writing-mode: vertical-rl; }</style></head>
<body class="vrtl"><h2>直排的第一章</h2>
${body}
<div class="inline" style="writing-mode: vertical-rl">行內樣式也是直排</div>
</body></html>
`;
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fjd-vertical</dc:identifier><dc:title>直排的書</dc:title><dc:language>zh-TW</dc:language><dc:creator>陳大文</dc:creator></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="vertical.css" media-type="text/css"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine page-progression-direction="rtl"><itemref idref="c1"/></spine>
</package>
`;
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目錄</title></head><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">直排的第一章</a></li></ol></nav></body></html>
`;
  const css = `html { writing-mode: vertical-rl; -epub-writing-mode: vertical-rl; -webkit-writing-mode: vertical-rl; }
body { writing-mode: vertical-rl; -epub-writing-mode: vertical-rl; }
p { margin: 0; }
`;
  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>
`;
  return Buffer.from(
    zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8(container),
      'OEBPS/content.opf': strToU8(opf),
      'OEBPS/nav.xhtml': strToU8(nav),
      'OEBPS/vertical.css': strToU8(css),
      'OEBPS/c1.xhtml': strToU8(html),
    }, { mtime: new Date(2026, 9, 28) }), // 固定时间戳，输出才是确定的
  );
}

// ---------------------------------------------------------------- 输出
const outputs = {
  'tw-sample.fb2': buildFb2(),
  'tw-big5.txt': buildBig5Txt(),
  'tw-sample.mobi': buildMobi6(),
  'tw-sample.azw3': buildAzw3(CONTENT),
  'tw-vertical.epub': buildVerticalEpub(),
  'sc-utf8.txt': buildSimplifiedTxt(),
};


for (const [name, buf] of Object.entries(outputs)) {
  fs.writeFileSync(path.join(here, name), buf);
  console.log(`${name}\t${buf.length} 字节`);
}
