/** 引擎版本。规则（转换、清理、合并）一旦改动，版本号加一；标注定位依赖它。 */
export const ENGINE_VERSION = 1;

export type Variant = 'tw' | 'hk' | 't'; // 台湾 / 香港 / 通用繁体

export interface ScriptInfo {
  script: 'hant' | 'hans' | 'mixed' | 'none';
  confidence: number; // 0..1
  variant: Variant;
}

export interface ConvertOptions {
  convert: boolean; // 总开关（繁/简按钮）
  vocabulary: boolean; // 词汇层：tw → twp 词典；hk/t 时没有词汇层
  quotes: boolean; // 「」『』 → “”‘’
  cleanup: boolean; // 排版清理总开关（只有 ctx.pdfReflow 为真才真正执行 R1、R2）
  horizontal: boolean; // 竖排转横排
  variant: Variant;
}

export const DEFAULT_OPTIONS: ConvertOptions = {
  convert: true,
  vocabulary: true,
  quotes: true,
  cleanup: true,
  horizontal: true,
  variant: 'tw',
};

export interface BookContext {
  pdfReflow: boolean;
}

export interface TransformEnv {
  DOMParser: typeof DOMParser;
  XMLSerializer: typeof XMLSerializer;
}

export interface TransformStats {
  /** 被转换改动的字符数（字形、词汇、标点合计） */
  convertedChars: number;
  /** R1 删掉的空格个数 */
  spacesRemoved: number;
  /** R2 合并掉的段落个数 */
  paragraphsMerged: number;
  /** R0 删掉的“汉字之间的换行”处数（扩展字段，设计里没有） */
  newlinesRemoved: number;
}

/**
 * 改动追踪（扩展，供 CLI 的 report 抽样用）。引擎不依赖它：不传就不产生任何额外开销。
 * rule：char 字形，vocab 词汇，quotes 引号，punct 竖排标点，R0/R1/R2 清理规则。
 */
export interface TraceEvent {
  rule: 'char' | 'vocab' | 'quotes' | 'punct' | 'R0' | 'R1' | 'R2';
  prefix: string;
  before: string;
  after: string;
  suffix: string;
}
export type Trace = (e: TraceEvent) => void;

export function emptyStats(): TransformStats {
  return { convertedChars: 0, spacesRemoved: 0, paragraphsMerged: 0, newlinesRemoved: 0 };
}
