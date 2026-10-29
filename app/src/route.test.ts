import { describe, expect, it } from 'vitest';
import { parseRoute } from './route';

describe('parseRoute', () => {
  it('书库是默认路由', () => {
    expect(parseRoute('')).toEqual({ name: 'library' });
    expect(parseRoute('#/library')).toEqual({ name: 'library' });
    expect(parseRoute('#/nonsense')).toEqual({ name: 'library' });
  });
  it('阅读路由带书 id', () => {
    expect(parseRoute('#/reader/abc123')).toEqual({ name: 'reader', id: 'abc123' });
    expect(parseRoute('#/reader/abc123?x=1')).toEqual({ name: 'reader', id: 'abc123' });
    expect(parseRoute('#/reader/%E4%B9%A6')).toEqual({ name: 'reader', id: '书' });
  });
  it('坏的编码回到书库而不是抛错', () => {
    expect(parseRoute('#/reader/%E4%B9')).toEqual({ name: 'library' });
  });
});
