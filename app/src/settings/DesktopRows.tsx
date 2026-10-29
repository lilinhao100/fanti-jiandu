import { useCallback, useEffect, useState } from 'react';
import { getPlatform } from '../platform';
import { Switch } from '../ui/Switch';

type Status = { supported: boolean; auto: boolean; shortcuts: boolean; associations: boolean };

/**
 * “关于”页里的桌面集成：首次运行自动创建快捷方式和文件关联的开关，以及“移除”按钮。
 * 只有桌面外壳提供 platform.desktop；其他环境不显示。
 */
export function DesktopRows({ Row }: { Row: (p: { label: string; hint?: string; children: React.ReactNode }) => React.JSX.Element }) {
  const desktop = getPlatform().desktop;
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (desktop) setStatus(await desktop.status());
  }, [desktop]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!desktop || !status?.supported) return null;
  const registered = status.shortcuts || status.associations;
  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  return (
    <>
      <div className="s-group-title">系统集成</div>
      <Row label="创建快捷方式和文件关联" hint="开始菜单、桌面快捷方式，并把 epub、mobi、azw3、fb2 加入“打开方式”">
        <Switch label="创建快捷方式和文件关联" checked={status.auto} disabled={busy} onChange={(on) => void run(() => desktop.setAuto(on))} />
      </Row>
      <Row label="移除快捷方式和文件关联" hint={registered ? '同时关闭上面的开关' : '当前没有创建'}>
        <button className="btn" disabled={busy || !registered} data-testid="desktop-remove" onClick={() => void run(() => desktop.remove())}>
          移除
        </button>
      </Row>
    </>
  );
}
