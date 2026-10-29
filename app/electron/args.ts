// 命令行参数：挑出书路径和我们自己的开关。纯函数。
import fs from 'node:fs';
import path from 'node:path';

/** 能打开的扩展名（小写）。与 import/prepare.ts、Rust 版 BOOK_EXTS 保持一致 */
export const BOOK_EXTS = ['epub', 'mobi', 'prc', 'azw3', 'azw', 'kf8', 'fb2', 'txt'];

export const extOf = (p: string): string => path.extname(p).slice(1).toLowerCase();

/** 是存在的、扩展名合法的书文件就返回它的绝对路径，否则 null */
export function bookPathOf(p: string, cwd?: string): string | null {
  if (typeof p !== 'string' || p === '' || p.startsWith('-')) return null;
  const abs = path.isAbsolute(p) ? p : cwd ? path.resolve(cwd, p) : path.resolve(p);
  try {
    return fs.statSync(abs).isFile() && BOOK_EXTS.includes(extOf(abs)) ? abs : null;
  } catch {
    return null; // 不存在就跳过
  }
}

/** 从参数里挑出存在的、扩展名合法的文件路径。argv 的第 0 项是可执行文件，跳过 */
export function pathsFromArgs(argv: string[], cwd?: string): string[] {
  const out: string[] = [];
  for (const a of argv.slice(1)) {
    const p = bookPathOf(a, cwd);
    if (p) out.push(p);
  }
  return out;
}

/**
 * 待打开的文件队列。启动参数、单实例转发（Windows）、macOS 的 open-file 事件（含拖到 Dock 图标上）都往里放，
 * 书库窗口加载好后取走（fjd:take-pending-open-files）。macOS 的 open-file 可能在 app ready 之前就到了，所以先排队，窗口起来后再取。
 */
export class OpenFileQueue {
  private paths: string[] = [];

  /** 放进一个路径；不是可打开的书、或者已经在队列里就返回 false */
  push(p: string, cwd?: string): boolean {
    const abs = bookPathOf(p, cwd);
    if (!abs || this.paths.includes(abs)) return false;
    this.paths.push(abs);
    return true;
  }

  /** 已经筛过的路径（来自 pathsFromArgs）整批放入，返回实际新增了几个 */
  pushAll(paths: string[]): number {
    let n = 0;
    for (const p of paths) if (!this.paths.includes(p)) (this.paths.push(p), n++);
    return n;
  }

  /** 取走全部待打开的文件 */
  take(): string[] {
    return this.paths.splice(0, this.paths.length);
  }

  get size(): number {
    return this.paths.length;
  }
}

export interface Flags {
  noRegister: boolean;
  userData?: string;
}

export function parseFlags(argv: string[], env: NodeJS.ProcessEnv = process.env): Flags {
  const flags: Flags = { noRegister: false };
  for (const a of argv.slice(1)) {
    if (a === '--no-register') flags.noRegister = true;
    else if (a.startsWith('--user-data=')) flags.userData = a.slice('--user-data='.length);
  }
  if (env.FJD_NO_REGISTER === '1') flags.noRegister = true;
  if (!flags.userData && env.FJD_USER_DATA) flags.userData = env.FJD_USER_DATA;
  return flags;
}
