import { describe, expect, it } from 'vitest';
import { bookIdOf, sha256Hex } from './hash';

describe('sha256Hex', () => {
  it('匹配已知向量', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('bookIdOf 取前 16 位，同样的内容得到同样的 id', async () => {
    const a = await bookIdOf(new TextEncoder().encode('abc'));
    expect(a).toBe('ba7816bf8f01cfea');
    expect(await bookIdOf(new TextEncoder().encode('abc').buffer)).toBe(a);
    expect(await bookIdOf(new TextEncoder().encode('abd'))).not.toBe(a);
  });

  it('子视图只算视图范围内的字节', async () => {
    const big = new Uint8Array([9, 9, ...new TextEncoder().encode('abc'), 9]);
    expect(await bookIdOf(big.subarray(2, 5))).toBe('ba7816bf8f01cfea');
  });
});
