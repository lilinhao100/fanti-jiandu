import { Check, MagnifyingGlass, Trash, X } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FontRef } from '../../model';
import { useFonts } from '../../store/fonts';
import { buildPickerRows, sampleFamily, type PickerFont, type PickerRow } from '../fonts';

/** 行高：分组标题 30，字体 48。固定行高，虚拟滚动只渲染看得见的那几行 */
const HEADER_H = 30;
const ITEM_H = 48;
const OVERSCAN = 5;
/** 每一项的示例（M2d）：繁体简读 Aa */
export const SAMPLE_TEXT = '繁体简读 Aa';

interface Layout {
  tops: number[];
  total: number;
}

function layoutRows(rows: PickerRow[]): Layout {
  const tops: number[] = [];
  let y = 0;
  for (const r of rows) {
    tops.push(y);
    y += r.kind === 'header' ? HEADER_H : ITEM_H;
  }
  return { tops, total: y };
}

/** 第一个下沿在 y 之下的行 */
function firstVisible(tops: number[], rows: PickerRow[], y: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const bottom = tops[mid]! + (rows[mid]!.kind === 'header' ? HEADER_H : ITEM_H);
    if (bottom <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 字体页：搜索框 + 三组列表（推荐 / 我导入的 / 系统字体）+ “导入字体…”。
 * 列表虚拟滚动，系统里有几百个字体也不卡。mode = west 时选的是西文字体，多一项“跟随中文字体”。
 */
export function FontPicker({
  mode,
  selectedId,
  onSelect,
}: {
  mode: 'zh' | 'west';
  /** 现在选中的项：zh 是字体 id；west 是字体 id 或 follow */
  selectedId: string;
  onSelect(ref: FontRef): void;
}) {
  const list = useFonts((s) => s.list);
  const listLoaded = useFonts((s) => s.listLoaded);
  const importFonts = useFonts((s) => s.importFonts);
  const removeFont = useFonts((s) => s.removeFont);
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(300);
  const [importing, setImporting] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const placed = useRef(false);

  const rows = useMemo(() => buildPickerRows(list, query, { west: mode === 'west' }), [list, query, mode]);
  const layout = useMemo(() => layoutRows(rows), [rows]);

  // 容器高度随窗口变化
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setHeight(el.clientHeight);
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 选中的那一项不在视野里就滚过去 */
  const reveal = (): boolean => {
    const el = boxRef.current;
    if (!el) return false;
    const i = rows.findIndex((r) => r.kind === 'font' && r.font.ref.id === selectedId);
    if (i < 0) return false;
    const top = layout.tops[i]!;
    if (top < el.scrollTop || top + ITEM_H > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - HEADER_H - ITEM_H);
      setScrollTop(el.scrollTop);
    }
    return true;
  };

  // 打开时把选中的那一项滚到视野里（只做一次，搜索之后不再动）；弹出动画期间布局可能还没稳，下一帧再确认一次
  useLayoutEffect(() => {
    if (placed.current || query) return;
    if (reveal()) {
      placed.current = true;
      const raf = requestAnimationFrame(() => void reveal());
      return () => cancelAnimationFrame(raf);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, layout, selectedId, query]);

  // 选中的项变了（比如删掉了选中的导入字体、退回宋体）：不在视野里就滚过去
  useLayoutEffect(() => {
    if (placed.current) reveal();
    // 只在选中项变化时处理；滚动和搜索由用户自己控制
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // 搜索词变了，回到顶部
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [query]);

  const start = Math.max(0, firstVisible(layout.tops, rows, scrollTop) - OVERSCAN);
  let end = start;
  while (end < rows.length && layout.tops[end]! < scrollTop + height + OVERSCAN * ITEM_H) end++;

  const firstFont = rows.find((r): r is Extract<PickerRow, { kind: 'font' }> => r.kind === 'font');

  const doImport = async (): Promise<void> => {
    setImporting(true);
    try {
      const added = await importFonts();
      if (added.length > 0) {
        // 导入后滚到“我导入的”那一组，让人看到新字体
        setQuery('');
        requestAnimationFrame(() => {
          const el = boxRef.current;
          const rs = buildPickerRows(useFonts.getState().list, '', { west: mode === 'west' });
          const i = rs.findIndex((r) => r.kind === 'header' && r.key === 'h:imported');
          if (el && i >= 0) {
            el.scrollTop = layoutRows(rs).tops[i]!;
            setScrollTop(el.scrollTop);
          }
        });
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fp" data-testid="font-page">
      <label className="fp-search">
        <MagnifyingGlass size={14} aria-hidden />
        <input
          type="text"
          value={query}
          placeholder="搜索字体"
          aria-label="搜索字体"
          data-testid="font-search"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && firstFont) {
              e.preventDefault();
              onSelect(firstFont.font.ref);
            }
          }}
        />
        {query && (
          <button className="fp-clear" aria-label="清除搜索" onClick={() => setQuery('')}>
            <X size={12} weight="bold" />
          </button>
        )}
      </label>
      <div
        ref={boxRef}
        className="fp-list"
        role="radiogroup"
        aria-label={mode === 'west' ? '西文字体' : '字体'}
        data-testid="font-list"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        {rows.length === 0 && <div className="fp-empty">{listLoaded ? '没有找到字体' : '正在读取字体…'}</div>}
        <div className="fp-spacer" style={{ height: layout.total }}>
          {rows.slice(start, end).map((r, k) => {
            const i = start + k;
            const style = { top: layout.tops[i], height: r.kind === 'header' ? HEADER_H : ITEM_H };
            if (r.kind === 'header') {
              return (
                <div key={r.key} className="fp-header" style={style} role="presentation">
                  {r.label}
                </div>
              );
            }
            return (
              <FontRow
                key={r.key}
                font={r.font}
                selected={r.font.ref.id === selectedId}
                style={style}
                onSelect={() => onSelect(r.font.ref)}
                onRemove={r.font.removable ? () => void removeFont(r.font.ref.id) : undefined}
              />
            );
          })}
        </div>
      </div>
      <button className="fp-import" data-testid="font-import" disabled={importing} onClick={() => void doImport()}>
        导入字体…
      </button>
    </div>
  );
}

function FontRow({
  font,
  selected,
  style,
  onSelect,
  onRemove,
}: {
  font: PickerFont;
  selected: boolean;
  style: { top: number | undefined; height: number };
  onSelect(): void;
  onRemove?: () => void;
}) {
  const family = font.group === 'follow' ? 'var(--font-ui)' : sampleFamily(font.ref);
  return (
    <div className={`fp-row${selected ? ' selected' : ''}`} style={style}>
      <button className="fp-item" role="radio" aria-checked={selected} data-testid="font-item" data-font-id={font.ref.id} onClick={onSelect}>
        <span className="fp-text">
          <span className="fp-name" style={{ fontFamily: family }}>
            {font.label}
          </span>
          {font.group !== 'follow' && !(font.group === 'recommended' && font.ref.id === 'default') ? (
            <span className="fp-sample" style={{ fontFamily: family }}>
              {SAMPLE_TEXT}
            </span>
          ) : (
            <span className="fp-sample">{font.group === 'follow' ? '西文和数字用中文字体自带的字形' : '用书里指定的字体'}</span>
          )}
        </span>
        {font.noCJK && <span className="fp-tag">无中文</span>}
        {selected && <Check className="fp-check" size={14} weight="bold" aria-hidden />}
      </button>
      {onRemove && (
        <button className="fp-del" aria-label={`删除字体 ${font.label}`} title="删除" data-testid="font-delete" onClick={onRemove}>
          <Trash size={14} />
        </button>
      )}
    </div>
  );
}
