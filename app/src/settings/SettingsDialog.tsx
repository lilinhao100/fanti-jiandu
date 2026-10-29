import { ENGINE_VERSION } from '@fjd/engine';
import { ArrowsClockwise, Info, X, BookOpenText } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isPresetFontId, presetRef, type FontInfo, type FontRef, type Settings } from '../model';
import { availablePresets } from '../fonts/presets';
import { currentOs } from '../platform/os';
import { sampleFamily } from '../reader/fonts';
import { useFonts } from '../store/fonts';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { Switch } from '../ui/Switch';
import { DesktopRows } from './DesktopRows';
import pkg from '../../package.json';

type Section = 'conversion' | 'reading' | 'about';

const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: 'conversion', label: '繁简转换', icon: <ArrowsClockwise size={18} /> },
  { id: 'reading', label: '阅读', icon: <BookOpenText size={18} /> },
  { id: 'about', label: '关于', icon: <Info size={18} /> },
];

const CONVERSION_ROWS: { key: keyof Settings['conversion']; label: string; hint: string }[] = [
  { key: 'vocabulary', label: '词汇转换', hint: '台湾、香港用语转成大陆用语' },
  { key: 'quotes', label: '引号转换', hint: '「」转成“”' },
  { key: 'cleanup', label: '排版清理', hint: '修复从 PDF 转来的书' },
  { key: 'horizontal', label: '竖排书改为横排', hint: '' },
];

/** 默认字体：当前系统的推荐字体（Windows 是 DESIGN 0.1 的 5 个，mac 见 fonts/presets.ts；原始放最后）。在外观面板里选了别的字体时，最前面多一行显示它 */
const fontOptions = (list: FontInfo[]): { ref: FontRef; label: string }[] => {
  const presets = availablePresets(currentOs(), list);
  return [...presets.filter((f) => f.id !== 'default'), ...presets.filter((f) => f.id === 'default')].map((f) => ({ ref: presetRef(f.id), label: f.label }));
};

const MODES: { id: Settings['appearance']['mode']; label: string }[] = [
  { id: 'light', label: '浅色' },
  { id: 'dark', label: '深色' },
  { id: 'auto', label: '自动' },
];

const LICENSES = [
  { name: 'OpenCC（opencc-js）', license: 'Apache-2.0 / MIT', note: '繁简字形与词汇词典' },
  { name: 'foliate-js', license: 'MIT', note: '电子书解析与分页' },
  { name: 'Phosphor Icons', license: 'MIT', note: '界面图标' },
];

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="s-row">
      <div className="s-text">
        <div className="s-label">{label}</div>
        {hint && <div className="s-hint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function ConversionPane() {
  const conversion = useSettings((s) => s.settings.conversion);
  const update = useSettings((s) => s.update);
  return (
    <>
      {CONVERSION_ROWS.map((r) => (
        <Row key={r.key} label={r.label} hint={r.hint}>
          <Switch
            label={r.label}
            checked={conversion[r.key]}
            onChange={(v) => void update((s) => ({ ...s, conversion: { ...s.conversion, [r.key]: v } }))}
          />
        </Row>
      ))}
      <p className="s-footnote">所有转换都在本机完成，不联网；原文件不会被修改。</p>
    </>
  );
}

function ReadingPane() {
  const appearance = useSettings((s) => s.settings.appearance);
  const animated = useSettings((s) => s.settings.reading.animated);
  const update = useSettings((s) => s.update);
  const fontList = useFonts((s) => s.list);
  // 当前字体可能是外观面板里选的系统字体或导入的字体：读一遍列表，显示它的中文名（书库窗口里没人读过）
  useEffect(() => {
    void useFonts.getState().refresh();
  }, []);
  const custom: FontRef | null = isPresetFontId(appearance.font.id) ? null : appearance.font;
  const presets = fontOptions(fontList);
  const options = custom ? [{ ref: custom, label: fontList.find((f) => f.id === custom.id)?.displayName ?? custom.family }, ...presets] : presets;
  return (
    <>
      <div className="s-group-title">默认字体</div>
      <div className="s-list" role="radiogroup" aria-label="默认字体">
        {options.map((f) => (
          <button
            key={f.ref.id}
            className="s-option"
            role="radio"
            aria-checked={appearance.font.id === f.ref.id}
            onClick={() => void update((s) => ({ ...s, appearance: { ...s.appearance, font: f.ref, fontPinned: true } }))}
          >
            <span style={{ fontFamily: sampleFamily(f.ref) }}>{f.label}</span>
            {f.ref.id === 'default' && <span className="s-hint">用书里指定的字体</span>}
            <span className="s-radio" aria-hidden />
          </button>
        ))}
      </div>
      <Row label="页面模式" hint="自动：跟随系统">
        <div className="segmented" role="radiogroup" aria-label="页面模式">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={appearance.mode === m.id}
              onClick={() => void update((s) => ({ ...s, appearance: { ...s.appearance, mode: m.id } }))}
            >
              {m.label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="翻页动画">
        <Switch label="翻页动画" checked={animated} onChange={(v) => void update((s) => ({ ...s, reading: { ...s.reading, animated: v } }))} />
      </Row>
    </>
  );
}

function AboutPane() {
  return (
    <>
      <div className="about-head">
        <div className="about-name">繁体简读</div>
        <div className="s-hint">繁体书，简体读</div>
      </div>
      <Row label="版本号">
        <span className="s-value" data-testid="about-version">
          {pkg.version}
        </span>
      </Row>
      <Row label="引擎版本">
        <span className="s-value" data-testid="about-engine">
          {ENGINE_VERSION}
        </span>
      </Row>
      <DesktopRows Row={Row} />
      <div className="s-group-title">开源许可</div>
      {LICENSES.map((l) => (
        <Row key={l.name} label={l.name} hint={l.note}>
          <span className="s-value">{l.license}</span>
        </Row>
      ))}
    </>
  );
}

/**
 * 设置窗口：600×460 的模态窗口，左边分类，右边内容（DESIGN 第 4 节）。
 * web 版里做成模态层；Tauri 版（M3）再改成独立窗口。
 */
export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  const setOpen = useUi((s) => s.setSettingsOpen);
  const [section, setSection] = useState<Section>('conversion');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  // Esc 关闭：焦点不在窗口里（点了遮罩外、失焦）时也要管用
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;
  const title = SECTIONS.find((s) => s.id === section)!.label;

  return (
    <div className="dialog-backdrop" onClick={() => setOpen(false)} data-testid="settings-backdrop">
      <div
        ref={ref}
        className="settings"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        tabIndex={-1}
        data-testid="settings"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // 模态层打开时，方向键、PageUp 等不要传给后面的阅读页
          if (!e.ctrlKey && !e.metaKey && e.key !== 'Tab' && e.key !== 'Escape') e.stopPropagation();
        }}
      >
        <nav className="settings-nav" aria-label="设置分类">
          {SECTIONS.map((s) => (
            <button key={s.id} className={`item${section === s.id ? ' selected' : ''}`} aria-current={section === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
              {s.icon}
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
        <section className="settings-body">
          <header className="settings-head">
            <h2>{title}</h2>
            <button className="icon-btn" aria-label="关闭设置" onClick={() => setOpen(false)}>
              <X size={16} weight="bold" />
            </button>
          </header>
          <div className="settings-scroll">
            {section === 'conversion' && <ConversionPane />}
            {section === 'reading' && <ReadingPane />}
            {section === 'about' && <AboutPane />}
          </div>
        </section>
      </div>
    </div>
  );
}
