import { MagnifyingGlass } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef } from 'react';
import { EMPTY_SEARCH, useReaderStore, type SearchState } from '../../store/reader';
import { Popover } from '../../ui/Popover';
import type { ReaderController } from '../controller';

let runId = 0;
const DEBOUNCE_MS = 280;

/** 搜索：输入繁体或简体都行（控制器会转成当前显示的字形）；结果按章节分组；点击跳转并闪烁高亮（DESIGN 2.9） */
export function SearchPanel({
  anchor,
  ctrl,
  focusKey,
  onPick,
}: {
  anchor: HTMLElement | null;
  ctrl: ReaderController | null;
  /** 每次 Ctrl+F 加一，让输入框重新获得焦点并选中 */
  focusKey: number;
  onPick(cfi: string): void;
}) {
  const search = useReaderStore((s) => s.search);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const set = (patch: Partial<SearchState>): void => useReaderStore.getState().set({ search: { ...useReaderStore.getState().search, ...patch } });

  const run = (q: string): void => {
    clearTimeout(timer.current);
    const id = ++runId;
    if (!ctrl || !q.trim()) {
      ctrl?.clearSearch();
      set({ ...EMPTY_SEARCH, query: q });
      return;
    }
    set({ query: q, hits: [], busy: true, done: false, truncated: false });
    void ctrl
      .searchStream(q, (batch) => {
        if (id === runId) set({ hits: [...useReaderStore.getState().search.hits, ...batch] });
      })
      .then((truncated) => {
        if (id === runId) set({ busy: false, done: true, truncated });
      })
      .catch((e) => {
        console.warn(e);
        if (id === runId) set({ busy: false, done: true });
      });
  };

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);

  // 关闭面板：停掉搜索、去掉页面上的命中标记（结果列表留着，下次打开还在）
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      runId++;
      ctrl?.clearSearch();
      const st = useReaderStore.getState().search;
      if (st.busy) useReaderStore.getState().set({ search: { ...st, busy: false } });
    },
    [ctrl],
  );

  const groups = useMemo(() => {
    const out: { label: string; hits: SearchState['hits'] }[] = [];
    for (const h of search.hits) {
      const last = out[out.length - 1];
      if (last && last.label === h.label) last.hits.push(h);
      else out.push({ label: h.label, hits: [h] });
    }
    return out;
  }, [search.hits]);

  const q = search.query.trim();
  return (
    <Popover anchor={anchor} width={360} align="end" label="搜索" testId="search-panel">
      <div className="sp-field">
        <MagnifyingGlass size={16} />
        <input
          ref={input}
          type="search"
          value={search.query}
          placeholder="在书中搜索"
          aria-label="在书中搜索"
          data-testid="search-input"
          autoFocus
          onChange={(e) => {
            const v = e.target.value;
            set({ query: v });
            clearTimeout(timer.current);
            timer.current = setTimeout(() => run(v), DEBOUNCE_MS);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              run(search.query);
            }
          }}
        />
      </div>
      <div className="popover-body sp-results" data-testid="search-results">
        {groups.map((g, gi) => (
          <div key={`${gi}-${g.label}`} className="sp-group" data-testid="search-group">
            <div className="sp-chapter">{g.label || '正文'}</div>
            {g.hits.map((h, i) => (
              <button key={`${h.cfi}-${i}`} className="sp-hit" data-testid="search-hit" onClick={() => onPick(h.cfi)}>
                <span className="sp-text">
                  {h.excerpt.pre}
                  <b>{h.excerpt.match}</b>
                  {h.excerpt.post}
                </span>
              </button>
            ))}
          </div>
        ))}
        {q && search.busy && <div className="panel-status" role="status">正在搜索…</div>}
        {q && search.done && !search.busy && search.hits.length === 0 && <div className="panel-empty">没有找到“{q}”</div>}
        {search.truncated && <div className="panel-status">只显示前 {search.hits.length} 处，请换个更具体的词</div>}
        {!q && <div className="panel-empty panel-hint">输入繁体或简体都可以</div>}
      </div>
    </Popover>
  );
}
