// 最小的 KF8（azw3）写入器。只实现 foliate-js 的 mobi.js 读取 KF8 时用到的部分：
// 每章一个骨架（skeleton）+ 一个片段（fragment）、骨架表、片段表、目录（NCX）、EXTH。
// 参照 vendor/foliate-js/mobi.js 的 KF8 类与 getIndexData/getNCX 反推格式。
import { Bytes, buildPdb, esc, vwi } from './util.mjs';

const ENC = 65001;
const INDX_HEADER_LEN = 192;
const MOBI_LEN = 264;
const RECORD = 4096;
const NONE = 0xffffffff;

/** 一条索引记录里的一个条目：名字 + 控制字节 + 各个标签的值 */
function entry(name, control, values) {
  const out = new Bytes();
  const nameBuf = Buffer.from(name, 'utf8');
  out.u8(nameBuf.length).push(nameBuf).u8(control);
  for (const v of values) out.push(vwi(v));
  return out.done();
}

/** TAGX：每个标签 4 字节 [tag, numValues, mask, endFlag]，以 [0,0,0,1] 结束；1 个控制字节 */
function tagx(tags) {
  const out = new Bytes().str('TAGX').u32(12 + 4 * (tags.length + 1)).u32(1);
  for (const [tag, numValues, mask] of tags) out.u8(tag).u8(numValues).u8(mask).u8(0);
  out.u8(0).u8(0).u8(0).u8(1);
  return out.done();
}

function indxHeader({ idxt, numRecords, total, numCncx }) {
  const h = Buffer.alloc(INDX_HEADER_LEN);
  h.write('INDX', 0, 'latin1');
  h.writeUInt32BE(INDX_HEADER_LEN, 4);
  h.writeUInt32BE(idxt, 20);
  h.writeUInt32BE(numRecords, 24);
  h.writeUInt32BE(ENC, 28);
  h.writeUInt32BE(0xffffffff, 32);
  h.writeUInt32BE(total, 36);
  h.writeUInt32BE(NONE, 40);
  h.writeUInt32BE(NONE, 44);
  h.writeUInt32BE(0, 48);
  h.writeUInt32BE(numCncx, 52);
  return h;
}

/**
 * 生成一个完整的索引：[头记录][数据记录][CNCX 记录…]
 * entries：已编码的条目；cncxStrings：CNCX 里的字符串（偏移 = 在记录里的位置）
 */
function buildIndex(tagDefs, entries, cncxStrings = []) {
  // 头记录：INDX 头 + TAGX
  const head = Buffer.concat([
    indxHeader({ idxt: 0, numRecords: 1, total: entries.length, numCncx: cncxStrings.length ? 1 : 0 }),
    tagx(tagDefs),
  ]);

  // 数据记录：INDX 头 + 条目 + IDXT
  let offset = INDX_HEADER_LEN;
  const offsets = entries.map((e) => {
    const o = offset;
    offset += e.length;
    return o;
  });
  const pad = (4 - (offset % 4)) % 4;
  const idxtAt = offset + pad;
  const idxt = new Bytes().str('IDXT');
  for (const o of offsets) idxt.u16(o);
  const data = Buffer.concat([
    indxHeader({ idxt: idxtAt, numRecords: entries.length, total: entries.length, numCncx: 0 }),
    ...entries,
    Buffer.alloc(pad),
    idxt.done(),
    Buffer.alloc(2 * (entries.length % 2)), // 对齐到 4 字节
  ]);

  const records = [head, data];
  const cncxOffsets = [];
  if (cncxStrings.length) {
    const c = new Bytes();
    for (const s of cncxStrings) {
      cncxOffsets.push(c.length);
      const b = Buffer.from(s, 'utf8');
      c.push(vwi(b.length)).push(b);
    }
    records.push(c.done());
  }
  return { records, cncxOffsets };
}

export function buildAzw3({ title, author, chapters }) {
  // ---- 1. 原始文本流：每章 = 骨架 + 片段，依次排开
  const sections = [];
  let raw = Buffer.alloc(0);
  chapters.forEach((c, k) => {
    const head = `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(c.title)}</title></head><body>`;
    const skel = Buffer.from(head + '</body></html>', 'utf8');
    const frag = Buffer.from(
      `<h2 id="ch${k}">${esc(c.title)}</h2>` + c.paragraphs.map((p) => `<p>${esc(p)}</p>`).join(''),
      'utf8',
    );
    sections.push({
      skelOffset: raw.length,
      skelLength: skel.length,
      insertOffset: raw.length + Buffer.byteLength(head),
      fragLength: frag.length,
      fid: k,
    });
    raw = Buffer.concat([raw, skel, frag]);
  });
  const textRecords = [];
  for (let i = 0; i < raw.length; i += RECORD) textRecords.push(raw.subarray(i, i + RECORD));

  // ---- 2. 骨架表（标签 1：片段数；标签 6：偏移 + 长度）
  const skelIdx = buildIndex(
    [
      [1, 1, 0x03],
      [6, 2, 0x0c],
    ],
    sections.map((s, k) => entry(`SKEL${String(k).padStart(7, '0')}`, 0x05, [1, s.skelOffset, s.skelLength])),
  );

  // ---- 3. 片段表（标签 2：选择器在 CNCX 里的位置；标签 4：片段序号 fid；标签 6：偏移 + 长度）
  const fragIdx = buildIndex(
    [
      [2, 1, 0x01],
      [4, 1, 0x02],
      [6, 2, 0x04],
    ],
    sections.map((s) => entry(String(s.insertOffset), 0x07, [0, s.fid, 0, s.fragLength])),
    ['id="ch0"'],
  );

  // ---- 4. 目录 NCX（标签 3：标题在 CNCX 里的位置；4：层级；6：[fid, 偏移]）
  const ncxLabels = chapters.map((c) => c.title);
  const ncxProbe = buildIndex([[3, 1, 0x01], [4, 1, 0x02], [6, 2, 0x04]], [], ncxLabels);
  const ncxIdx = buildIndex(
    [
      [3, 1, 0x01],
      [4, 1, 0x02],
      [6, 2, 0x04],
    ],
    sections.map((s, k) => entry(String(k).padStart(3, '0'), 0x07, [ncxProbe.cncxOffsets[k], 0, s.fid, 0])),
    ncxLabels,
  );

  // ---- 5. 记录排布：0 = 头记录，1..n = 文本，之后依次是三个索引
  const firstIndexRecord = 1 + textRecords.length;
  const skelAt = firstIndexRecord;
  const fragAt = skelAt + skelIdx.records.length;
  const ncxAt = fragAt + fragIdx.records.length;
  const total = ncxAt + ncxIdx.records.length;

  // ---- 6. 记录 0：PalmDOC 头 + MOBI 头（KF8）+ EXTH + 书名
  const exthRecs = [
    [100, Buffer.from(author, 'utf8')],
    [524, Buffer.from('zh-TW', 'utf8')],
    [527, Buffer.from('ltr', 'utf8')],
  ];
  const exthBody = new Bytes();
  for (const [type, data] of exthRecs) exthBody.u32(type).u32(8 + data.length).push(data);
  const exthLen = 12 + exthBody.length;
  const exthPad = (4 - (exthLen % 4)) % 4;
  const exth = new Bytes()
    .str('EXTH')
    .u32(exthLen + exthPad)
    .u32(exthRecs.length)
    .push(exthBody.done())
    .zeros(exthPad)
    .done();

  const titleBuf = Buffer.from(title, 'utf8');
  const titleOffset = 16 + MOBI_LEN + exth.length;
  const rec0 = Buffer.alloc(titleOffset + titleBuf.length + 4);
  rec0.writeUInt16BE(1, 0); // 不压缩
  rec0.writeUInt32BE(raw.length, 4);
  rec0.writeUInt16BE(textRecords.length, 8);
  rec0.writeUInt16BE(RECORD, 10);
  rec0.write('MOBI', 16, 'latin1');
  rec0.writeUInt32BE(MOBI_LEN, 20);
  rec0.writeUInt32BE(2, 24);
  rec0.writeUInt32BE(ENC, 28);
  rec0.writeUInt32BE(0x5678, 32);
  rec0.writeUInt32BE(8, 36); // version 8 → KF8
  rec0.writeUInt32BE(titleOffset, 84);
  rec0.writeUInt32BE(titleBuf.length, 88);
  rec0.writeUInt8(1 << 2, 94);
  rec0.writeUInt8(4, 95);
  rec0.writeUInt32BE(total, 108); // 资源起点：没有资源
  rec0.writeUInt32BE(NONE, 112);
  rec0.writeUInt32BE(0x40, 128);
  rec0.writeUInt32BE(0, 240);
  rec0.writeUInt32BE(ncxAt, 244); // NCX 索引
  rec0.writeUInt32BE(NONE, 192); // FDST：没有（foliate 在 try 里读它，读不到就跳过）
  rec0.writeUInt32BE(0, 196);
  rec0.writeUInt32BE(fragAt, 248);
  rec0.writeUInt32BE(skelAt, 252);
  rec0.writeUInt32BE(NONE, 260); // 没有 guide
  exth.copy(rec0, 16 + MOBI_LEN);
  titleBuf.copy(rec0, titleOffset);

  return buildPdb('FJD_Fixture_AZW3', [rec0, ...textRecords, ...skelIdx.records, ...fragIdx.records, ...ncxIdx.records]);
}
