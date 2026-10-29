// 由“这本书的检测结果 + 繁/简按钮状态 + 设置”算出引擎的 ConvertOptions。
import { DEFAULT_OPTIONS, type ConvertOptions, type ScriptInfo } from '@fjd/engine';
import type { BookRecord, Settings } from '../model';

type ScriptState = Pick<BookRecord, 'script' | 'display'>;

/** 书是不是繁体（决定“繁/简”按钮是否可用，以及是否转换） */
export function isTraditional(script: ScriptInfo | undefined): boolean {
  return script?.script === 'hant' || script?.script === 'mixed';
}

export function displayMode(record: Pick<BookRecord, 'display'>): 'converted' | 'original' {
  return record.display === 'original' ? 'original' : 'converted';
}

/**
 * 繁体书：自动转成简体（display = converted），按钮可切回原文（original）。
 * 简体书或没有汉字的书：不做字形/词汇/标点转换，但竖排转横排、换行清理仍按设置生效。
 * original 模式：所有“改文字”的处理都关掉，只留竖排转横排（那是布局，不是文字）。
 */
export function effectiveOptions(
  record: ScriptState,
  conversion: Settings['conversion'],
  modeOverride?: 'converted' | 'original',
): ConvertOptions {
  const mode = modeOverride ?? displayMode(record);
  const converting = mode === 'converted' && isTraditional(record.script);
  return {
    ...DEFAULT_OPTIONS,
    convert: converting,
    vocabulary: conversion.vocabulary,
    quotes: converting && conversion.quotes,
    cleanup: mode === 'converted' && conversion.cleanup,
    horizontal: conversion.horizontal,
    variant: record.script?.variant ?? 'tw',
  };
}

/** 书名、作者、目录、搜索词用的选项（只有字形、词汇、引号，没有排版） */
export function textOptions(record: ScriptState, conversion: Settings['conversion']): ConvertOptions {
  return effectiveOptions(record, conversion);
}

/** 标注定位要用：选项的稳定字符串（ARCHITECTURE 3.4 Highlight.anchor.optsKey） */
export function optsKey(o: ConvertOptions): string {
  return [o.convert, o.vocabulary, o.quotes, o.cleanup, o.horizontal, o.variant].map((x) => (x === true ? 1 : x === false ? 0 : x)).join('');
}
