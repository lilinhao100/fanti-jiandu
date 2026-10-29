// 生成小书用的共用工具：二进制拼接、PDB 容器、XML 转义
export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** MOBI 索引里的变长整数：高位在前，最后一个字节的最高位置 1（对应 mobi.js 的 getVarLen） */
export function vwi(n) {
  const groups = [];
  do {
    groups.unshift(n & 0x7f);
    n = Math.floor(n / 128);
  } while (n > 0);
  groups[groups.length - 1] |= 0x80;
  return Buffer.from(groups);
}

// ---------------------------------------------------------------- 二进制小工具
export class Bytes {
  constructor() {
    this.parts = [];
    this.length = 0;
  }
  push(buf) {
    this.parts.push(buf);
    this.length += buf.length;
    return this;
  }
  u8(n) {
    return this.push(Buffer.from([n & 0xff]));
  }
  u16(n) {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(n);
    return this.push(b);
  }
  u32(n) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n >>> 0);
    return this.push(b);
  }
  str(s, enc = 'utf8') {
    return this.push(Buffer.from(s, enc));
  }
  zeros(n) {
    return this.push(Buffer.alloc(n));
  }
  done() {
    return Buffer.concat(this.parts);
  }
}

/** 把若干记录拼成 PDB 文件 */
export function buildPdb(name, records) {
  const header = Buffer.alloc(78);
  header.write(name.slice(0, 31), 0, 'latin1');
  header.writeUInt16BE(0, 32); // attributes
  header.writeUInt16BE(0, 34); // version
  // 创建/修改/备份时间：固定值，保证输出确定
  header.writeUInt32BE(3_800_000_000, 36);
  header.writeUInt32BE(3_800_000_000, 40);
  header.write('BOOK', 60, 'latin1');
  header.write('MOBI', 64, 'latin1');
  header.writeUInt32BE(records.length * 2 + 1, 68); // uniqueIDseed
  header.writeUInt16BE(records.length, 76);
  const listLen = records.length * 8 + 2;
  let offset = 78 + listLen;
  const list = Buffer.alloc(listLen);
  records.forEach((r, i) => {
    list.writeUInt32BE(offset, i * 8);
    list.writeUInt32BE(i * 2, i * 8 + 4); // attrs(1) + uid(3)
    offset += r.length;
  });
  return Buffer.concat([header, list, ...records]);
}

