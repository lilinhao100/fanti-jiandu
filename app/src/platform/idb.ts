// 极简 IndexedDB 封装（库名 fjd）。web 平台实现用它存书文件、封面和 JSON。
export const DB_NAME = 'fjd';
export const DB_VERSION = 2;
export type StoreName = 'books' | 'files' | 'covers' | 'kv' | 'fonts';

export function openDb(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('covers')) db.createObjectStore('covers');
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      // v2（M2d）：导入的字体文件，键是内容哈希
      if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('无法打开 IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB 被其他标签页占用'));
  });
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('事务中止'));
  });
}

export class Idb {
  constructor(private readonly db: IDBDatabase) {}

  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    const tx = this.db.transaction(store, 'readonly');
    return (await wrap(tx.objectStore(store).get(key))) as T | undefined;
  }

  async getAll<T>(store: StoreName): Promise<T[]> {
    const tx = this.db.transaction(store, 'readonly');
    return (await wrap(tx.objectStore(store).getAll())) as T[];
  }

  /** 连键一起取出 */
  async getAllEntries<T>(store: StoreName): Promise<{ key: string; value: T }[]> {
    const tx = this.db.transaction(store, 'readonly');
    const os = tx.objectStore(store);
    const [keys, values] = await Promise.all([wrap(os.getAllKeys()), wrap(os.getAll())]);
    return keys.map((k, i) => ({ key: String(k), value: values[i] as T }));
  }

  /** 读-改-写放在同一个事务里，避免两次并发更新互相覆盖 */
  async update<T>(store: StoreName, key: string, fn: (old: T) => T): Promise<boolean> {
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    const old = (await wrap(os.get(key))) as T | undefined;
    if (old === undefined) {
      await done(tx);
      return false;
    }
    os.put(fn(old));
    await done(tx);
    return true;
  }

  async put(store: StoreName, value: unknown, key?: string): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    await done(tx);
  }

  async delete(store: StoreName, key: string): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await done(tx);
  }

  /** 一个事务里写多个存储，要么全成功要么全失败 */
  async putMany(items: { store: StoreName; value: unknown; key?: string }[]): Promise<void> {
    const stores = [...new Set(items.map((i) => i.store))];
    const tx = this.db.transaction(stores, 'readwrite');
    for (const it of items) tx.objectStore(it.store).put(it.value, it.key);
    await done(tx);
  }

  async deleteMany(items: { store: StoreName; key: string }[]): Promise<void> {
    const stores = [...new Set(items.map((i) => i.store))];
    const tx = this.db.transaction(stores, 'readwrite');
    for (const it of items) tx.objectStore(it.store).delete(it.key);
    await done(tx);
  }
}
