import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseFlags, pathsFromArgs } from './args';
import { DataStore } from './store';
import { isVisible, loadWindowStates, restore, saveWindowStates } from './windowState';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjd-store-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('importPaths', () => {
  it('流式 sha256 当 id、复制进 books、重复导入去重', async () => {
    const store = new DataStore(path.join(dir, 'data'));
    store.ensureDirs();
    const src = path.join(dir, 'hello.txt');
    fs.writeFileSync(src, 'hello');
    const [r] = await store.importPaths([src]);
    // sha256("hello") = 2cf24dba5fb0a30e...
    expect(r).toMatchObject({ id: '2cf24dba5fb0a30e', ext: 'txt', existed: false, size: 5, error: null });
    expect(fs.existsSync(path.join(dir, 'data', 'books', '2cf24dba5fb0a30e.txt'))).toBe(true);
    const [again] = await store.importPaths([src]);
    expect(again!.existed).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'data', 'books')).filter((n) => n.endsWith('.part'))).toEqual([]);
  });
  it('空文件、不支持的格式、不存在的文件都报错而不是抛出', async () => {
    const store = new DataStore(path.join(dir, 'data'));
    store.ensureDirs();
    const empty = path.join(dir, 'e.epub');
    const pdf = path.join(dir, 'a.pdf');
    fs.writeFileSync(empty, '');
    fs.writeFileSync(pdf, 'x');
    const rs = await store.importPaths([empty, pdf, path.join(dir, 'missing.epub')]);
    expect(rs.map((r) => r.error)).toEqual(['文件是空的', expect.stringContaining('不支持'), expect.any(String)]);
    expect(rs.every((r) => r.id === null)).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'data', 'books'))).toEqual([]);
  });
});

describe('JSON 读写', () => {
  it('原子写：写完只剩目标文件，没有 .tmp；并发写同一文件不丢最后一次', async () => {
    const store = new DataStore(dir);
    store.ensureDirs();
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.writeJson('library.json', { version: 1, n: i })));
    expect(await store.readJson('library.json')).toEqual({ version: 1, n: 19 });
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
  it('文件不存在返回 undefined；坏 JSON 留备份再当作没有', async () => {
    const store = new DataStore(dir);
    store.ensureDirs();
    expect(await store.readJson('settings.json')).toBeUndefined();
    fs.writeFileSync(path.join(dir, 'settings.json'), '{坏了');
    expect(await store.readJson('settings.json')).toBeUndefined();
    expect(fs.readdirSync(dir).some((n) => n.startsWith('settings.json.corrupt-'))).toBe(true);
  });
  it('越界的路径一律拒绝', async () => {
    const store = new DataStore(dir);
    store.ensureDirs();
    await expect(store.readJson('../x.json')).rejects.toThrow();
    await expect(store.writeFile('books/../library.json', new Uint8Array([1]))).rejects.toThrow();
    await expect(store.remove(['..\\x'])).rejects.toThrow();
    await expect(store.listDir('..')).rejects.toThrow();
  });
  it('文件的读写、存在、列目录、删除', async () => {
    const store = new DataStore(dir);
    store.ensureDirs();
    await store.writeFile('covers/a.jpg', new Uint8Array([1, 2, 3]));
    expect(Array.from(await store.readFile('covers/a.jpg'))).toEqual([1, 2, 3]);
    expect(await store.exists('covers/a.jpg')).toBe(true);
    expect(await store.listDir('covers')).toEqual(['a.jpg']);
    await store.remove(['covers/a.jpg', 'covers/none.jpg']);
    expect(await store.listDir('covers')).toEqual([]);
  });
});

describe('命令行参数', () => {
  it('只留存在的、扩展名合法的文件；相对路径按 cwd 解析；跳过开关', () => {
    const ok = path.join(dir, 'a.EPUB');
    const bad = path.join(dir, 'b.pdf');
    fs.writeFileSync(ok, 'x');
    fs.writeFileSync(bad, 'x');
    const argv = ['app.exe', '--inspect=0', ok, bad, path.join(dir, 'missing.epub'), 'a.EPUB', '--no-register'];
    expect(pathsFromArgs(argv, dir)).toEqual([ok, ok]);
  });
  it('开关：--no-register、--user-data=、环境变量', () => {
    expect(parseFlags(['x', '--no-register', '--user-data=C:\\d'], {})).toEqual({ noRegister: true, userData: 'C:\\d' });
    expect(parseFlags(['x'], { FJD_USER_DATA: 'E:\\e', FJD_NO_REGISTER: '1' })).toEqual({ noRegister: true, userData: 'E:\\e' });
    expect(parseFlags(['x'], {})).toEqual({ noRegister: false });
  });
});

describe('窗口位置', () => {
  it('存取、丢弃坏数据', () => {
    const f = path.join(dir, 'ws.json');
    saveWindowStates(f, { main: { x: 1, y: 2, width: 800, height: 600, maximized: true } });
    expect(loadWindowStates(f)).toEqual({ main: { x: 1, y: 2, width: 800, height: 600, maximized: true } });
    fs.writeFileSync(f, JSON.stringify({ main: { x: 'a' }, reader: { x: 0, y: 0, width: 10, height: 10 } }));
    expect(loadWindowStates(f)).toEqual({});
    expect(loadWindowStates(path.join(dir, 'none.json'))).toEqual({});
  });
  it('位置跑到屏幕外时只保留大小，并且不小于最小尺寸', () => {
    const screens = [{ x: 0, y: 0, width: 1920, height: 1040 }];
    expect(isVisible({ x: 100, y: 100, width: 800, height: 600 }, screens)).toBe(true);
    expect(isVisible({ x: 3000, y: 100, width: 800, height: 600 }, screens)).toBe(false);
    const saved = { x: 3000, y: 100, width: 300, height: 200, maximized: false };
    expect(restore(saved, screens, { width: 760, height: 520 })).toEqual({ bounds: { width: 760, height: 520 }, maximized: false });
    expect(restore(undefined, screens, { width: 1, height: 1 })).toBeNull();
  });
});
