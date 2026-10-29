import { CaretLeft, CaretRight, CircleHalf, GearSix, Moon, Sun, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { APPEARANCE_RANGES, DEFAULT_SETTINGS, FONT_SIZE_RANGE, type Settings } from '../../model';
import { withShortcut } from '../../lib/shortcuts';
import { useFonts } from '../../store/fonts';
import { useReaderStore } from '../../store/reader';
import { Popover } from '../../ui/Popover';
import { Slider } from '../../ui/Slider';
import { Switch } from '../../ui/Switch';
import { canStepFont, displayNameOf, stepFontSize } from '../fonts';
import { effectiveFont, THEMES, themeSwatch } from '../styles';
import { FontPicker } from './FontPicker';

type Appearance = Settings['appearance'];

const COLUMN_OPTIONS: { id: Appearance['columns']; testId: string; label: string }[] = [
  { id: 'auto', testId: 'auto', label: '自动' },
  { id: 'one', testId: 'one', label: '单栏' },
  { id: 'two', testId: 'two', label: '双栏' },
];

const MODES: { id: Appearance['mode']; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: '浅色', icon: Sun },
  { id: 'dark', label: '深色', icon: Moon },
  { id: 'auto', label: '自动', icon: CircleHalf },
];

/** “主题与设置”弹出面板：主页 + 字体与版式页（DESIGN 2.5）。所有改动立刻写进设置并作用到正文 */
export function AppearancePanel({
  anchor,
  appearance: a,
  onChange,
}: {
  anchor: HTMLElement | null;
  appearance: Appearance;
  onChange(patch: Partial<Appearance>): void;
}) {
  const [page, setPage] = useState<'main' | 'custom' | 'font' | 'west'>('main');
  const fontList = useFonts((s) => s.list);
  const notice = useFonts((s) => s.notice);
  const current = effectiveFont(a);
  const size = a.fontSize;
  const twoColumns = useReaderStore((st) => st.twoColumns);

  // 打开面板时读一遍字体列表（系统字体、导入的字体），并检查设置里的字体还在不在
  useEffect(() => {
    void useFonts.getState().refresh();
    // 关面板时提示就算看过了
    return () => useFonts.getState().setNotice(null);
  }, []);

  const noticeBar = notice && (
    <div className={`ap-notice ${notice.kind}`} role="status" data-testid="font-notice">
      <span>{notice.text}</span>
      <button aria-label="关闭提示" onClick={() => useFonts.getState().setNotice(null)}>
        <X size={12} weight="bold" />
      </button>
    </div>
  );

  return (
    <Popover anchor={anchor} width={300} align="end" label="主题与设置" testId="appearance-panel" className={`appearance page-${page}`}>
      {page === 'main' ? (
        <div className="ap-page">
          <h2 className="ap-title">主题与设置</h2>
          <div className="ap-row">
            <div className="ap-size" role="group" aria-label="字号">
              <button aria-label="减小字号" title={withShortcut('减小字号', 'font-smaller')} disabled={!canStepFont(size, -1)} onClick={() => onChange({ fontSize: stepFontSize(size, -1) })}>
                <span className="glyph-a small">A</span>
              </button>
              <span className="ap-divider" aria-hidden />
              <button
                aria-label="增大字号"
                title={withShortcut('增大字号', 'font-bigger')}
                disabled={!canStepFont(size, 1)}
                onClick={() => onChange({ fontSize: stepFontSize(size, 1) })}
              >
                <span className="glyph-a big">A</span>
              </button>
            </div>
            <div className="ap-modes" role="radiogroup" aria-label="页面模式">
              {MODES.map((m) => (
                <button key={m.id} role="radio" aria-checked={a.mode === m.id} aria-label={m.label} title={m.label} onClick={() => onChange({ mode: m.id })}>
                  <m.icon size={16} weight={a.mode === m.id ? 'fill' : 'regular'} />
                </button>
              ))}
            </div>
          </div>
          <div className="ap-themes" role="radiogroup" aria-label="阅读主题">
            {THEMES.map((t) => {
              const sw = themeSwatch(t.id);
              return (
                <button
                  key={t.id}
                  className="ap-tile"
                  role="radio"
                  aria-checked={a.theme === t.id}
                  aria-label={t.name}
                  data-testid={`theme-${t.id}`}
                  style={{ background: sw.bg, color: sw.fg }}
                  onClick={() => onChange({ theme: t.id })}
                >
                  <span className="sample" style={{ fontFamily: sw.fontFamily, fontWeight: sw.fontWeight }}>
                    Aa
                  </span>
                  <span className="name">{t.name}</span>
                </button>
              );
            })}
          </div>
          <button className="ap-custom" data-testid="appearance-custom" onClick={() => setPage('custom')}>
            <GearSix size={16} />
            字体与版式
          </button>
        </div>
      ) : page === 'font' || page === 'west' ? (
        <div className="ap-page ap-font-page">
          <div className="ap-head">
            <button className="ap-back" data-testid="font-back" onClick={() => setPage('custom')}>
              <CaretLeft size={14} weight="bold" />
              返回
            </button>
            <h2 className="ap-title">{page === 'west' ? '西文字体' : '字体'}</h2>
          </div>
          {noticeBar}
          <FontPicker
            mode={page === 'west' ? 'west' : 'zh'}
            selectedId={page === 'west' ? (a.fontWest?.id ?? 'follow') : current.id}
            onSelect={(ref) => {
              if (page === 'west') onChange({ fontWest: ref.id === 'follow' ? null : ref });
              else onChange({ font: ref, fontPinned: true });
            }}
          />
        </div>
      ) : (
        <div className="ap-page ap-custom-page" data-testid="appearance-custom-page">
          <div className="ap-head">
            <button className="ap-back" onClick={() => setPage('main')}>
              <CaretLeft size={14} weight="bold" />
              返回
            </button>
            <h2 className="ap-title">字体与版式</h2>
          </div>
          <div className="ap-scroll">
            {noticeBar}
            <div className="ap-group-label first">字体</div>
            <div className="ap-fonts">
              <button data-testid="font-row" onClick={() => setPage('font')}>
                <span className="label">字体</span>
                <span className="value">{displayNameOf(current, fontList)}</span>
                <CaretRight className="chev" size={12} weight="bold" />
              </button>
              <button data-testid="west-row" onClick={() => setPage('west')}>
                <span className="label">西文字体</span>
                <span className="value">{a.fontWest ? displayNameOf(a.fontWest, fontList) : '跟随中文字体'}</span>
                <CaretRight className="chev" size={12} weight="bold" />
              </button>
            </div>
            <div className="ap-size-row">
              <SliderRow
                label="字号"
                value={size}
                range={FONT_SIZE_RANGE}
                show={(v) => `${Math.round(v)}px`}
                onChange={(v) => onChange({ fontSize: Math.round(v) })}
              />
            </div>
            <div className="ap-switch-row">
              <span>粗体文本</span>
              <Switch label="粗体文本" checked={a.bold || a.theme === 'bold'} disabled={a.theme === 'bold'} onChange={(v) => onChange({ bold: v })} />
            </div>
            <div className="ap-group-label">版式</div>
            <div className="ap-cols" role="radiogroup" aria-label="栏数">
              {COLUMN_OPTIONS.map((c) => (
                <button key={c.id} role="radio" aria-checked={a.columns === c.id} data-testid={`columns-${c.testId}`} onClick={() => onChange({ columns: c.id })}>
                  {c.label}
                </button>
              ))}
            </div>
            {a.columns === 'two' && !twoColumns && (
              <div className="ap-cols-hint" data-testid="columns-hint">
                窗口太窄，暂时显示为单栏
              </div>
            )}
            <SliderRow label="行间距" value={a.lineHeight} range={APPEARANCE_RANGES.lineHeight} show={(v) => v.toFixed(2)} onChange={(v) => onChange({ lineHeight: v })} />
            <SliderRow label="页边距" value={a.margin} range={APPEARANCE_RANGES.margin} show={(v) => `${v.toFixed(1)}×`} onChange={(v) => onChange({ margin: v })} />
            <SliderRow label="字符间距" value={a.letterSpacing} range={APPEARANCE_RANGES.letterSpacing} show={(v) => `${v.toFixed(2)}em`} onChange={(v) => onChange({ letterSpacing: v })} />
            <SliderRow label="词间距" value={a.wordSpacing} range={APPEARANCE_RANGES.wordSpacing} show={(v) => `${v.toFixed(2)}em`} onChange={(v) => onChange({ wordSpacing: v })} />
            <div className="ap-switch-row">
              <span>两端对齐</span>
              <Switch label="两端对齐" checked={a.justify} onChange={(v) => onChange({ justify: v })} />
            </div>
            <button
              className="ap-reset"
              data-testid="appearance-reset"
              onClick={() => {
                const d = DEFAULT_SETTINGS.appearance;
                // 恢复这一页的所有项：字体回到主题自带的，粗体、栏数和全部版式回到默认；主题、页面模式不动
                onChange({
                  font: d.font,
                  fontPinned: d.fontPinned,
                  fontWest: d.fontWest,
                  fontSize: d.fontSize,
                  bold: d.bold,
                  columns: d.columns,
                  lineHeight: d.lineHeight,
                  letterSpacing: d.letterSpacing,
                  wordSpacing: d.wordSpacing,
                  margin: d.margin,
                  justify: d.justify,
                });
              }}
            >
              恢复默认
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}

function SliderRow({
  label,
  value,
  range,
  show,
  onChange,
}: {
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  show(v: number): string;
  onChange(v: number): void;
}) {
  return (
    <div className="ap-slider-row">
      <div className="ap-slider-head">
        <span>{label}</span>
        <span className="value">{show(value)}</span>
      </div>
      <Slider value={value} {...range} label={label} onChange={onChange} />
    </div>
  );
}
