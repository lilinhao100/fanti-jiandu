import { useEffect, useState } from 'react';
import { getPlatform } from '../platform';
import { currentOs } from '../platform/os';

// Segoe Fluent Icons 字形：最小化 E921、最大化 E922、还原 E923、关闭 E8BB（DESIGN 2.3）
const GLYPH = { min: '', max: '', restore: '', close: '' } as const;

/**
 * Windows 风格的窗口按钮，每个 46×32，贴在窗口右上角。
 * web 版里按钮不起作用（platform.window 是空实现），但照常显示，方便验收外观。
 */
export function WindowControls() {
  // macOS：用系统的红黄绿按钮（窗口创建时 titleBarStyle: 'hiddenInset'），不画 Windows 按钮
  if (currentOs() === 'mac') return null;
  return <WindowsControls />;
}

function WindowsControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let alive = true;
    void getPlatform()
      .window.isMaximized()
      .then((m) => alive && setMaximized(m));
    // 双击标题栏、贴边吸附也会改变最大化状态，所以窗口大小一变就重新问一次
    const sync = (): void => {
      void getPlatform()
        .window.isMaximized()
        .then((m) => alive && setMaximized(m));
    };
    window.addEventListener('resize', sync);
    return () => {
      alive = false;
      window.removeEventListener('resize', sync);
    };
  }, []);
  const win = getPlatform().window;

  return (
    <div className="window-controls" data-testid="window-controls">
      <button className="wc-btn" aria-label="最小化" tabIndex={-1} onClick={() => win.minimize()}>
        {GLYPH.min}
      </button>
      <button
        className="wc-btn"
        aria-label={maximized ? '还原' : '最大化'}
        tabIndex={-1}
        onClick={() => {
          win.toggleMaximize();
          void win.isMaximized().then(setMaximized);
        }}
      >
        {maximized ? GLYPH.restore : GLYPH.max}
      </button>
      <button className="wc-btn close" aria-label="关闭" tabIndex={-1} onClick={() => win.close()}>
        {GLYPH.close}
      </button>
    </div>
  );
}
