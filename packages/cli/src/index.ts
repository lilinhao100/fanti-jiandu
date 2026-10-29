#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { ENGINE_VERSION, type TraceEvent } from '@fjd/engine';
import { convertEpub, writeEpub, type ConvertFlags } from './epub';

const USAGE = `用法：
  fjd convert <in.epub> <out.epub> [--no-vocab] [--no-quotes] [--no-cleanup]
                                   [--no-horizontal] [--variant tw|hk|t] [--reflow auto|on|off]
  fjd report <in.epub> [同上选项]

说明：
  --no-vocab       不做词汇层（只转字形）
  --no-quotes      「」『』 不转成 “” ‘’
  --no-cleanup     不做排版清理（R0、R1、R2 全关）
  --no-horizontal  不把竖排改成横排
  --variant        指定繁体变体；默认按书的语言标记和用字统计判断
  --reflow         PDF 转制：auto 自动检测（默认）、on 强制、off 关闭`;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** pnpm --filter 会把工作目录切到包目录；INIT_CWD 是用户敲命令时所在的目录。相对路径按它解析。 */
function userPath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

function parseArgs(argv: string[]): { positional: string[]; flags: ConvertFlags } {
  const positional: string[] = [];
  const flags: ConvertFlags = { vocabulary: true, quotes: true, cleanup: true, horizontal: true, reflow: 'auto' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const take = (): string => {
      const eq = a.indexOf('=');
      if (eq >= 0) return a.slice(eq + 1);
      const v = argv[++i];
      if (v === undefined) fail(`${a} 需要一个值`);
      return v;
    };
    if (a === '--no-vocab') flags.vocabulary = false;
    else if (a === '--no-quotes') flags.quotes = false;
    else if (a === '--no-cleanup') flags.cleanup = false;
    else if (a === '--no-horizontal') flags.horizontal = false;
    else if (a === '--variant' || a.startsWith('--variant=')) {
      const v = take();
      if (v !== 'tw' && v !== 'hk' && v !== 't') fail(`--variant 只能是 tw、hk、t，收到 ${v}`);
      flags.variant = v;
    } else if (a === '--reflow' || a.startsWith('--reflow=')) {
      const v = take();
      if (v !== 'auto' && v !== 'on' && v !== 'off') fail(`--reflow 只能是 auto、on、off，收到 ${v}`);
      flags.reflow = v;
    } else if (a.startsWith('--')) fail(`未知选项 ${a}\n\n${USAGE}`);
    else positional.push(a);
  }
  return { positional, flags };
}

/* ---------------------------------------------------------------- report 的抽样 */

/** 固定种子的随机数（mulberry32），保证每次 report 抽到同样的 20 处 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RULES = ['vocab', 'char', 'quotes', 'punct', 'R0', 'R1', 'R2'] as const;
type Rule = (typeof RULES)[number];
const QUOTA: Record<Rule, number> = { vocab: 5, char: 4, quotes: 2, punct: 1, R0: 2, R1: 3, R2: 3 };
const RULE_NAME: Record<Rule, string> = {
  vocab: '词汇层',
  char: '字形',
  quotes: '引号',
  punct: '竖排标点',
  R0: 'R0 汉字间换行',
  R1: 'R1 汉字间空格',
  R2: 'R2 合并断段',
};

class Sampler {
  counts: Record<Rule, number> = { vocab: 0, char: 0, quotes: 0, punct: 0, R0: 0, R1: 0, R2: 0 };
  private pool: Record<Rule, TraceEvent[]> = { vocab: [], char: [], quotes: [], punct: [], R0: [], R1: [], R2: [] };
  private rand = rng(20261028);
  private cap = 20;

  readonly trace = (e: TraceEvent): void => {
    const r = e.rule;
    const n = ++this.counts[r];
    const pool = this.pool[r];
    // 蓄水池抽样：每条规则保留 cap 个
    if (pool.length < this.cap) pool.push(e);
    else {
      const j = Math.floor(this.rand() * n);
      if (j < this.cap) pool[j] = e;
    }
  };

  pick(total: number): { rule: Rule; e: TraceEvent }[] {
    const chosen: { rule: Rule; e: TraceEvent }[] = [];
    const left: Record<Rule, TraceEvent[]> = { vocab: [], char: [], quotes: [], punct: [], R0: [], R1: [], R2: [] };
    for (const r of RULES) {
      const p = this.pool[r];
      const take = Math.min(QUOTA[r], p.length);
      for (let i = 0; i < take; i++) chosen.push({ rule: r, e: p[i]! });
      left[r] = p.slice(take);
    }
    // 配额没用满时，从剩下的轮流补
    let progress = true;
    while (chosen.length < total && progress) {
      progress = false;
      for (const r of RULES) {
        const e = left[r].shift();
        if (e && chosen.length < total) {
          chosen.push({ rule: r, e });
          progress = true;
        }
      }
    }
    return chosen.slice(0, total);
  }
}

function visible(s: string): string {
  return s.replace(/\r/g, '␍').replace(/\n/g, '⏎').replace(/\t/g, '⇥').replace(/\u00A0/g, '⍽').replace(/ /g, '␠');
}

function formatEvent(rule: Rule, e: TraceEvent): string {
  if (rule === 'R2') return `…${e.prefix}【¶ 合并】${e.suffix}…`;
  if (rule === 'R0' || rule === 'R1') return `…${e.prefix}【${visible(e.before)} 删除】${e.suffix}…`;
  return `…${e.prefix}【${e.before} → ${e.after}】${e.suffix}…`;
}

/* ---------------------------------------------------------------- 命令 */

function cmdConvert(argv: string[]): void {
  const { positional, flags } = parseArgs(argv);
  if (positional.length !== 2) fail(USAGE);
  const [inPath, outPath] = [userPath(positional[0]!), userPath(positional[1]!)];
  const r = convertEpub(new Uint8Array(readFileSync(inPath)), flags);
  const bytes = writeEpub(r.files, r.order);
  writeFileSync(outPath, bytes);
  for (const w of r.warnings) console.warn('警告：' + w);
  console.log(`已生成 ${outPath}（${(bytes.length / 1024 / 1024).toFixed(2)} MB）`);
  console.log(
    `检测：${r.info.script}（置信度 ${r.info.confidence}），变体 ${r.opts.variant}，PDF 转制 ${r.pdfReflow ? '是' : '否'}`,
  );
  console.log(
    `统计：convertedChars=${r.stats.convertedChars} spacesRemoved=${r.stats.spacesRemoved} ` +
      `paragraphsMerged=${r.stats.paragraphsMerged} newlinesRemoved=${r.stats.newlinesRemoved}`,
  );
  if (r.info.script === 'hans' || r.info.script === 'none') {
    console.warn(`提示：这本书看起来不是繁体（${r.info.script}），转换结果可能没有意义。`);
  }
}

function cmdReport(argv: string[]): void {
  const { positional, flags } = parseArgs(argv);
  if (positional.length !== 1) fail(USAGE);
  const inPath = userPath(positional[0]!);
  const sampler = new Sampler();
  const r = convertEpub(new Uint8Array(readFileSync(inPath)), flags, sampler.trace);

  console.log(`文件：${inPath}`);
  console.log(`引擎版本：${ENGINE_VERSION}`);
  console.log('');
  console.log('== 检测 ==');
  console.log(`  语言标记：${r.manifest.language || '（无）'}`);
  console.log(`  script：${r.info.script}（置信度 ${r.info.confidence}）`);
  console.log(`  variant：${r.opts.variant}`);
  console.log(`  pdfReflow：${r.pdfReflow}${flags.reflow === 'auto' ? '' : `（--reflow ${flags.reflow}）`}`);
  console.log(
    `  选项：词汇=${r.opts.vocabulary} 引号=${r.opts.quotes} 清理=${r.opts.cleanup} 竖转横=${r.opts.horizontal}`,
  );
  console.log('');
  console.log('== 各规则改动次数 ==');
  for (const rule of RULES) console.log(`  ${RULE_NAME[rule].padEnd(10, '\u3000')}${sampler.counts[rule]}`);
  console.log(`  convertedChars  ${r.stats.convertedChars}`);
  console.log(`  spacesRemoved   ${r.stats.spacesRemoved}（R1 删掉的空格字符数）`);
  console.log(`  newlinesRemoved ${r.stats.newlinesRemoved}（R0 处数）`);
  console.log(`  paragraphsMerged ${r.stats.paragraphsMerged}（R2）`);
  for (const w of r.warnings) console.log('  警告：' + w);
  console.log('');
  console.log('== 随机抽样 20 处改动（固定种子 20261028，按规则分层）==');
  const picked = sampler.pick(20);
  picked.forEach(({ rule, e }, i) => {
    console.log(`${String(i + 1).padStart(2)}. [${RULE_NAME[rule]}] ${formatEvent(rule, e)}`);
  });
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'convert') cmdConvert(rest);
else if (cmd === 'report') cmdReport(rest);
else {
  console.log(USAGE);
  process.exit(cmd === undefined || cmd === '--help' || cmd === '-h' ? 0 : 1);
}
