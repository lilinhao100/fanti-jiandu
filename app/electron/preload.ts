// 预加载脚本（sandbox 下运行，只能用 electron 的 contextBridge / ipcRenderer）。
// 只暴露 window.fjdElectron 这一个对象，每个方法对应主进程里一个带校验的 IPC 处理函数。
import { contextBridge, ipcRenderer } from 'electron';
import type { FjdElectronApi } from './api';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: unknown, ...args: unknown[]): void => cb(...(args as A));
  ipcRenderer.on(channel, listener);
  return () => void ipcRenderer.off(channel, listener);
}

const api: FjdElectronApi = {
  platform: process.platform,
  onMenuCommand: (cb) => subscribe<[string]>('fjd:menu-command', (command) => cb(command)),
  readJson: (rel) => invoke('fjd:read-json', rel),
  writeJson: (rel, data) => invoke('fjd:write-json', rel, data),
  readFile: (rel) => invoke('fjd:read-file', rel),
  writeFile: (rel, bytes) => invoke('fjd:write-file', rel, bytes),
  exists: (rel) => invoke('fjd:exists', rel),
  remove: (rels) => invoke('fjd:remove', rels),
  listDir: (dir) => invoke('fjd:list-dir', dir),
  importPaths: (paths) => invoke('fjd:import-paths', paths),
  pickFiles: () => invoke('fjd:pick-files'),
  openReader: (id) => invoke('fjd:open-reader', id),
  takePendingOpenFiles: () => invoke('fjd:take-pending-open-files'),
  onOpenFiles: (cb) => subscribe('fjd:open-files', () => cb()),
  notifyChanged: (kind) => ipcRenderer.send('fjd:data-changed', kind),
  onDataChanged: (cb) => subscribe<['library' | 'settings' | 'fonts']>('fjd:data-changed', (kind) => cb(kind)),
  fonts: {
    list: () => invoke('fjd:fonts-list'),
    import: () => invoke('fjd:fonts-import'),
    remove: (id) => invoke('fjd:fonts-remove', id),
    css: () => invoke('fjd:fonts-css'),
  },
  onBeforeClose: (handler) => {
    ipcRenderer.on('fjd:before-close', () => {
      void handler()
        .catch((e) => console.error('关闭前保存失败', e))
        .finally(() => ipcRenderer.send('fjd:close-ack'));
    });
  },
  window: {
    minimize: () => ipcRenderer.send('fjd:win', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('fjd:win', 'toggle-maximize'),
    close: () => ipcRenderer.send('fjd:win', 'close'),
    isMaximized: () => invoke('fjd:win-is-maximized'),
    setTitle: (t) => ipcRenderer.send('fjd:win-title', t),
    setButtonsVisible: (visible) => ipcRenderer.send('fjd:win-buttons', !!visible),
  },
  desktop: {
    status: () => invoke('fjd:desktop-status'),
    setAuto: (on) => invoke('fjd:desktop-set-auto', on),
    remove: () => invoke('fjd:desktop-remove'),
  },
};

contextBridge.exposeInMainWorld('fjdElectron', api);
