import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bookPathOf, OpenFileQueue, parseFlags, pathsFromArgs } from './args';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjd-args-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});
const touch = (name: string): string => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, 'x');
  return f;
};

describe('bookPathOf / pathsFromArgs', () => {
  it('存在且扩展名合法才算书；扩展名不分大小写；目录、不存在、选项参数都不算', () => {
    const a = touch('书.EPUB');
    touch('notes.pdf');
    fs.mkdirSync(path.join(dir, 'dir.epub'));
    expect(bookPathOf(a)).toBe(a);
    expect(bookPathOf(path.join(dir, 'notes.pdf'))).toBeNull();
    expect(bookPathOf(path.join(dir, 'dir.epub'))).toBeNull();
    expect(bookPathOf(path.join(dir, 'missing.epub'))).toBeNull();
    expect(bookPathOf('--no-register')).toBeNull();
    expect(bookPathOf('')).toBeNull();
    expect(bookPathOf('书.EPUB', dir)).toBe(a); // 相对路径按 cwd 解析
  });
  it('pathsFromArgs 跳过 argv[0] 和选项', () => {
    const a = touch('a.mobi');
    expect(pathsFromArgs(['app', '--no-register', a, path.join(dir, 'none.epub')])).toEqual([a]);
    expect(pathsFromArgs([a])).toEqual([]); // 第 0 项是可执行文件，不算
  });
});

describe('OpenFileQueue（macOS open-file 事件排队）', () => {
  it('ready 之前到的事件先排队，窗口起来后一次取走；取走后队列为空', () => {
    const q = new OpenFileQueue();
    const a = touch('a.epub');
    const b = touch('b.azw3');
    // 模拟启动前连续到达两个 open-file 事件（比如一次选中两本书双击）
    expect(q.push(a)).toBe(true);
    expect(q.push(b)).toBe(true);
    expect(q.size).toBe(2);
    expect(q.take()).toEqual([a, b]);
    expect(q.take()).toEqual([]);
  });
  it('不是书的、不存在的、重复的都不入队（拖到 Dock 的可能是任何文件）', () => {
    const q = new OpenFileQueue();
    const a = touch('a.fb2');
    expect(q.push(touch('readme.txt.bak'))).toBe(false);
    expect(q.push(path.join(dir, 'ghost.epub'))).toBe(false);
    expect(q.push(a)).toBe(true);
    expect(q.push(a)).toBe(false);
    expect(q.take()).toEqual([a]);
  });
  it('取走之后再来的事件重新排队', () => {
    const q = new OpenFileQueue();
    const a = touch('a.epub');
    q.push(a);
    q.take();
    expect(q.push(a)).toBe(true);
    expect(q.take()).toEqual([a]);
  });
  it('pushAll：启动参数、second-instance 带来的整批路径；返回新增个数', () => {
    const q = new OpenFileQueue();
    const a = touch('a.epub');
    const b = touch('b.epub');
    expect(q.pushAll([a, b])).toBe(2);
    expect(q.pushAll([b])).toBe(0);
    expect(q.take()).toEqual([a, b]);
  });
});

describe('parseFlags', () => {
  it('--no-register、--user-data、环境变量', () => {
    expect(parseFlags(['app', '--no-register', '--user-data=C:\\x'], {})).toEqual({ noRegister: true, userData: 'C:\\x' });
    expect(parseFlags(['app'], { FJD_NO_REGISTER: '1', FJD_USER_DATA: '/tmp/u' })).toEqual({ noRegister: true, userData: '/tmp/u' });
  });
});
