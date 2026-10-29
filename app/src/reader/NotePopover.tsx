import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Highlight } from '../model';
import { useReaderStore, type NoteEditorState } from '../store/reader';
import type { ReaderController } from './controller';

const WIDTH = 300;
const HEIGHT = 196; // 估计值，只用来决定放上面还是下面
const AUTOSAVE_MS = 400;

/**
 * 笔记编辑弹窗：多行文本，输入停下 0.4 秒后自动保存，关闭时再保存一次；Esc 关闭（Reader 里处理）。
 * 围着页面上的那条高亮放；从要点精选里打开时放在面板右边。
 */
export function NotePopover({ ctrl }: { ctrl: ReaderController | null }) {
  const ed = useReaderStore((s) => s.noteEditor);
  const h = useReaderStore((s) => (s.noteEditor ? s.highlights.find((x) => x.id === s.noteEditor!.id) : undefined));
  const shown = useReaderStore((s) => (s.noteEditor ? s.hlInfo[s.noteEditor.id]?.text : undefined));
  if (!ed || !h || !ctrl) return null;
  return <NoteBody key={ed.id} ctrl={ctrl} ed={ed} h={h} quote={shown || h.text} />;
}

function NoteBody({ ctrl, ed, h, quote }: { ctrl: ReaderController; ed: NoteEditorState; h: Highlight; quote: string }) {
  const [text, setText] = useState(h.note ?? '');
  const [saved, setSaved] = useState(false);
  const latest = useRef(text);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const area = useRef<HTMLTextAreaElement>(null);
  const id = h.id;

  const save = (): void => {
    clearTimeout(timer.current);
    ctrl.setHighlightNote(id, latest.current);
    setSaved(true);
  };

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // 关闭时（卸载）把没保存的存掉
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      ctrl.setHighlightNote(id, latest.current);
    },
    [ctrl, id],
  );

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = ed.rect;
  let left: number;
  let top: number;
  if (ed.from === 'panel') {
    left = r.right + 12;
    top = Math.min(r.top - 4, vh - HEIGHT - 12);
  } else {
    left = (r.left + r.right) / 2 - WIDTH / 2;
    top = r.bottom + 10;
    if (top + HEIGHT > vh - 12) top = Math.max(12, r.top - 10 - HEIGHT);
  }
  left = Math.max(12, Math.min(left, vw - WIDTH - 12));
  top = Math.max(12, top);

  return (
    <div className="note-pop glass" role="dialog" aria-label="笔记" data-note-root data-panel-root data-testid="note-editor" style={{ left, top, width: WIDTH }}>
      <div className="note-quote">
        <span className="bar" style={{ background: `var(--c-hl-${h.style})` }} aria-hidden />
        <span className="q">{quote}</span>
      </div>
      <textarea
        ref={area}
        className="note-input"
        data-testid="note-input"
        placeholder="写下笔记"
        rows={4}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          latest.current = v;
          setText(v);
          setSaved(false);
          clearTimeout(timer.current);
          timer.current = setTimeout(save, AUTOSAVE_MS);
        }}
      />
      <div className="note-foot" data-testid="note-status" aria-live="polite">
        {saved ? '已保存' : ''}
      </div>
    </div>
  );
}
