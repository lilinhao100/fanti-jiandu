/** 文件内容 sha256 的前 16 位十六进制，当作书的 id（ARCHITECTURE 3.4） */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // 拷贝一份给 digest：避免 SharedArrayBuffer / 子视图带来的类型和偏移问题
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function bookIdOf(data: ArrayBuffer | Uint8Array): Promise<string> {
  return (await sha256Hex(data)).slice(0, 16);
}
