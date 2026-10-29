// 下载官方 Electron 的 macOS 包，并用官方发布的 SHASUMS256.txt 校验。
// @electron/get 自己会校验一次；这里再独立核对一次（算文件的 SHA-256，对照同一版本发布页上的 SHASUMS256.txt），
// 两边都过才放行。下载走系统代理时，用 `node --use-env-proxy` 运行（见 package.json 的 pack:mac）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import { downloadArtifact } from '@electron/get';

export type MacArch = 'arm64' | 'x64';

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

/** 解析 SHASUMS256.txt（每行 `<hex> *<文件名>`）。返回 文件名 → 哈希 */
export function parseShasums(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const g = /^([0-9a-f]{64}) [ *](.+)$/i.exec(line.trim());
    if (g) m.set(g[2]!, g[1]!.toLowerCase());
  }
  return m;
}

export async function fetchOfficialMacZip(version: string, arch: MacArch): Promise<{ file: string; sha256: string }> {
  const file = await downloadArtifact({ version, artifactName: 'electron', platform: 'darwin', arch });
  const sums = await downloadArtifact({ version, artifactName: 'SHASUMS256.txt', isGeneric: true, unsafelyDisableChecksums: true });
  const want = parseShasums(fs.readFileSync(sums, 'utf8')).get(`electron-v${version}-darwin-${arch}.zip`);
  if (!want) throw new Error(`SHASUMS256.txt 里没有 electron-v${version}-darwin-${arch}.zip`);
  const got = await sha256File(file);
  if (got !== want) throw new Error(`校验失败：${file}\n  官方 SHASUMS256 ${want}\n  实际           ${got}`);
  return { file, sha256: got };
}
