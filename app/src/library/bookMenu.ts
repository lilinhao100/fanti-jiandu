import type { BookRecord } from '../model';
import { getPlatform } from '../platform';
import { useLibrary } from '../store/library';
import type { MenuEntry } from '../ui/Menu';
import { canToggleDisplay } from './text';

/** 封面下方、列表行末尾的“…”菜单：打开 / 显示原文或显示简体 / 从书库移除…（DESIGN 第 1 节） */
export function bookMenuEntries(book: BookRecord, onRemove: () => void): MenuEntry[] {
  const original = book.display === 'original';
  const entries: MenuEntry[] = [{ label: '打开', onSelect: () => void getPlatform().openReader(book.id) }];
  if (canToggleDisplay(book)) {
    entries.push({
      label: original ? '显示简体' : '显示原文',
      onSelect: () => void useLibrary.getState().setDisplay(book.id, original ? 'converted' : 'original'),
    });
  }
  entries.push({ kind: 'sep' }, { label: '从书库移除…', danger: true, onSelect: onRemove });
  return entries;
}
