export type Route = { name: 'library' } | { name: 'reader'; id: string };

/** 路由按 URL hash 区分窗口：#/library、#/reader/:bookId（ARCHITECTURE 3.2） */
export function parseRoute(hash: string): Route {
  const m = /^#\/reader\/([^/?#]+)/.exec(hash);
  if (m) {
    try {
      return { name: 'reader', id: decodeURIComponent(m[1]!) };
    } catch {
      return { name: 'library' };
    }
  }
  return { name: 'library' };
}
