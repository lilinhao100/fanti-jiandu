import type { ScriptInfo } from '@fjd/engine';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model';
import { displayMode, effectiveOptions, isTraditional, optsKey } from './options';

const hant: ScriptInfo = { script: 'hant', confidence: 0.95, variant: 'tw' };
const hans: ScriptInfo = { script: 'hans', confidence: 0.95, variant: 'tw' };
const conv = DEFAULT_SETTINGS.conversion;

describe('effectiveOptions', () => {
  it('繁体书默认转换：字形、词汇、引号、清理、横排都开', () => {
    const o = effectiveOptions({ script: hant }, conv);
    expect(o).toMatchObject({ convert: true, vocabulary: true, quotes: true, cleanup: true, horizontal: true, variant: 'tw' });
  });

  it('原文模式：不改文字，只留竖排转横排', () => {
    const o = effectiveOptions({ script: hant, display: 'original' }, conv);
    expect(o).toMatchObject({ convert: false, quotes: false, cleanup: false, horizontal: true });
  });

  it('简体书：不做字形转换，但清理照常', () => {
    const o = effectiveOptions({ script: hans }, conv);
    expect(o).toMatchObject({ convert: false, quotes: false, cleanup: true });
  });

  it('script 未知时按“不是繁体”处理（首次打开前会先检测）', () => {
    expect(effectiveOptions({}, conv).convert).toBe(false);
    expect(isTraditional(undefined)).toBe(false);
  });

  it('设置里的开关生效，香港繁体沿用 variant', () => {
    const o = effectiveOptions(
      { script: { script: 'hant', confidence: 1, variant: 'hk' } },
      { vocabulary: false, quotes: false, cleanup: false, horizontal: false },
    );
    expect(o).toMatchObject({ convert: true, vocabulary: false, quotes: false, cleanup: false, horizontal: false, variant: 'hk' });
  });

  it('modeOverride 优先于记录里的 display', () => {
    expect(effectiveOptions({ script: hant, display: 'original' }, conv, 'converted').convert).toBe(true);
    expect(displayMode({ display: undefined })).toBe('converted');
  });

  it('optsKey 对相同选项稳定，对不同选项不同', () => {
    const a = effectiveOptions({ script: hant }, conv);
    expect(optsKey(a)).toBe(optsKey({ ...a }));
    expect(optsKey(a)).not.toBe(optsKey({ ...a, vocabulary: false }));
  });
});
