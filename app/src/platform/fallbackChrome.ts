// 兜底的窗口按钮和拖动区：只在 Tauri 里、且界面自己没画拖动区（[data-tauri-drag-region]）时出现。
// 书库和阅读界面一旦自带标题栏，这里会在 1 秒内自动撤掉，不需要改任何代码。
// 样式按 DESIGN.md 2.3：按钮 46×32，Segoe Fluent Icons 字形，关闭按钮悬停变红。
import { getPlatform } from './index';

const ID = 'fjd-fallback-chrome';
const GLYPH = { min: '', max: '', restore: '', close: '' };

function ownDragRegionExists(): boolean {
  const host = document.getElementById(ID);
  return Array.from(document.querySelectorAll('[data-tauri-drag-region]')).some((el) => !host?.contains(el));
}

function build(): HTMLElement {
  const platform = getPlatform();
  const host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'position:fixed;top:0;left:0;right:0;height:32px;z-index:2147483000;pointer-events:none;';
  const style = document.createElement('style');
  style.textContent = `
    #${ID} .drag{position:absolute;top:0;left:0;right:138px;height:32px;pointer-events:auto}
    #${ID} .btns{position:absolute;top:0;right:0;display:flex;pointer-events:auto}
    #${ID} button{all:unset;box-sizing:border-box;width:46px;height:32px;display:grid;place-items:center;
      font:10px 'Segoe Fluent Icons','Segoe MDL2 Assets';color:#1f1f1f;cursor:default}
    #${ID} button:hover{background:rgba(0,0,0,.06)}
    #${ID} button.close:hover{background:#C42B1C;color:#fff}
    @media (prefers-color-scheme: dark){#${ID} button{color:#f2f2f2}#${ID} button:hover{background:rgba(255,255,255,.08)}}
  `;
  const drag = document.createElement('div');
  drag.className = 'drag';
  drag.setAttribute('data-tauri-drag-region', '');
  const btns = document.createElement('div');
  btns.className = 'btns';
  const mk = (cls: string, glyph: string, label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = glyph;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.addEventListener('click', onClick);
    return b;
  };
  const maxBtn = mk('max', GLYPH.max, '最大化', () => {
    platform.window.toggleMaximize();
    setTimeout(sync, 150);
  });
  const sync = (): void => {
    void platform.window.isMaximized().then((m) => {
      maxBtn.textContent = m ? GLYPH.restore : GLYPH.max;
      maxBtn.title = m ? '还原' : '最大化';
    });
  };
  window.addEventListener('resize', sync);
  btns.append(
    mk('min', GLYPH.min, '最小化', () => platform.window.minimize()),
    maxBtn,
    mk('close', GLYPH.close, '关闭', () => platform.window.close()),
  );
  host.append(style, drag, btns);
  return host;
}

export function installFallbackChrome(): void {
  if (getPlatform().kind !== 'tauri') return;
  const tick = (): void => {
    const present = document.getElementById(ID);
    if (ownDragRegionExists()) {
      present?.remove();
    } else if (!present) {
      document.body.append(build());
    }
  };
  tick();
  setInterval(tick, 1000);
}
