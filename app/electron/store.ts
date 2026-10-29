// 数据目录的读写（主进程）。结构与 Tauri 版一致：
//   books/<id>.<ext>  covers/<id>.jpg  annotations/<id>.json  fonts/  library.json  settings.json
// JSON 原子写：先写 .tmp 再重命名；同一个文件的写入在主进程里串行。
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { BOOK_EXTS, extOf } from './args';
import { DATA_DIRS, resolveData, resolveDataDir } from './paths';

/** 与 Rust 命令 import_files 的返回项一致（字段名见 app/src/platform/tauri.ts） */
export interface ImportedFile {
  path: string;
  name: string;
  ext: string;
  size: number;
  id: string | null;
  storedPath: string | null;
  existed: boolean;
  error: string | null;
}

let tmpSeq = 0;

/** 复制一个文件到 books 目录，同时流式计算 sha256（取前 16 位十六进制当 id） */
export async function importOne(
  booksDir: string,
  src: string,
): Promise<{ id: string; dest: string; existed: boolean; size: number }> {
  const ext = extOf(src);
  const tmp = path.join(booksDir, `.import-${process.pid}-${tmpSeq++}.part`);
  const hash = crypto.createHash('sha256');
  let size = 0;
  try {
    const input = fs.createReadStream(src);
    const out = fs.createWriteStream(tmp);
    await new Promise<void>((resolve, reject) => {
      input.on('data', (chunk) => {
        hash.update(chunk as Buffer);
        size += (chunk as Buffer).length;
      });
      input.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      input.pipe(out);
    });
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    throw new Error(`无法读取或写入文件：${e instanceof Error ? e.message : String(e)}`);
  }
  if (size === 0) {
    await fsp.rm(tmp, { force: true });
    throw new Error('文件是空的');
  }
  const id = hash.digest('hex').slice(0, 16);
  const dest = path.join(booksDir, `${id}.${ext}`);
  if (fs.existsSync(dest)) {
    await fsp.rm(tmp, { force: true });
    return { id, dest, existed: true, size };
  }
  try {
    await fsp.rename(tmp, dest);
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    throw new Error(`保存失败：${e instanceof Error ? e.message : String(e)}`);
  }
  return { id, dest, existed: false, size };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class DataStore {
  private chains = new Map<string, Promise<unknown>>();

  constructor(readonly root: string) {}

  ensureDirs(): void {
    fs.mkdirSync(this.root, { recursive: true });
    for (const d of DATA_DIRS) fs.mkdirSync(path.join(this.root, d), { recursive: true });
  }

  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    this.chains.set(key, tail);
    void tail.then(() => {
      if (this.chains.get(key) === tail) this.chains.delete(key);
    });
    return next;
  }

  async readJson(rel: string): Promise<unknown> {
    const file = resolveData(this.root, rel);
    let text: string;
    try {
      text = await fsp.readFile(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      // 文件坏了：留一份备份再当作没有，别让整个书库打不开
      console.error(`无法解析 ${file}`, e);
      await fsp.rename(file, `${file}.corrupt-${Date.now()}`).catch(() => {});
      return undefined;
    }
  }

  private async atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, data);
    for (let i = 0; ; i++) {
      try {
        await fsp.rename(tmp, file);
        return;
      } catch (e) {
        // Windows 上被杀毒软件或索引短暂占用时重试几次
        if (i >= 5) throw e;
        await sleep(40 * (i + 1));
      }
    }
  }

  /** 原子写：先写 .tmp 再重命名 */
  async writeJson(rel: string, data: unknown): Promise<void> {
    const file = resolveData(this.root, rel);
    const text = JSON.stringify(data);
    await this.serial(file, () => this.atomicWrite(file, text));
  }

  async writeFile(rel: string, bytes: Uint8Array): Promise<void> {
    const file = resolveData(this.root, rel);
    await this.serial(file, () => this.atomicWrite(file, bytes));
  }

  async readFile(rel: string): Promise<Uint8Array> {
    return new Uint8Array(await fsp.readFile(resolveData(this.root, rel)));
  }

  async exists(rel: string): Promise<boolean> {
    return fs.existsSync(resolveData(this.root, rel));
  }

  async remove(rels: string[]): Promise<void> {
    for (const rel of rels) await fsp.rm(resolveData(this.root, rel), { force: true });
  }

  async listDir(dir: string): Promise<string[]> {
    try {
      return (await fsp.readdir(resolveDataDir(this.root, dir))).filter((n) => !n.endsWith('.tmp'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  async importPaths(paths: string[]): Promise<ImportedFile[]> {
    const booksDir = path.join(this.root, 'books');
    fs.mkdirSync(booksDir, { recursive: true });
    const out: ImportedFile[] = [];
    for (const p of paths) {
      const name = path.basename(p);
      const ext = extOf(p);
      const fail = (error: string): ImportedFile => ({
        path: p,
        name,
        ext,
        size: 0,
        id: null,
        storedPath: null,
        existed: false,
        error,
      });
      if (!BOOK_EXTS.includes(ext)) {
        out.push(fail(`不支持的格式：${name}`));
        continue;
      }
      try {
        const r = await importOne(booksDir, p);
        out.push({ path: p, name, ext, size: r.size, id: r.id, storedPath: r.dest, existed: r.existed, error: null });
      } catch (e) {
        out.push(fail(e instanceof Error ? e.message : String(e)));
      }
    }
    return out;
  }
}
