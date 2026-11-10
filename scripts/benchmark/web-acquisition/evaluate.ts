import type { WebAcquisitionCheck, WebAcquisitionTask } from './tasks';

/** 一次工具调用的事实：参数原文、终态和输出原文（含子运行）。 */
export interface ToolCallFact {
  readonly runId: string;
  readonly toolName: string;
  readonly arguments: string;
  readonly status: 'success' | 'error' | null;
  readonly errorCode?: string;
  readonly observation: string;
  readonly data?: unknown;
}

export interface UsageFact {
  readonly calls: number;
  readonly uncachedInput: number;
  readonly cachedInput: number;
  readonly output: number;
  readonly listCostUsd: number;
}

export interface CheckResult {
  readonly id: string;
  readonly label: string;
  readonly passed: boolean;
  /** content：原文片段读到了没有、指定来源取得了没有，分开报。 */
  readonly contentRead?: boolean;
  readonly sourceFetched?: boolean;
}

export interface WebAcquisitionRunMetrics {
  readonly checks: readonly CheckResult[];
  readonly searches: number;
  readonly searchesWithConditions: { readonly site: number; readonly language: number; readonly recency: number; readonly objective: number };
  readonly reads: { readonly ok: number; readonly failed: number; readonly truncated: number; readonly files: number; readonly errors: Readonly<Record<string, number>> };
  readonly shellPdfAttempts: number;
  readonly children: number;
  readonly usage: UsageFact;
}

const SEARCH_TOOLS = new Set(['web_search', 'search_web']);
// 搜索摘要不算读到原文；本地读取和 Shell 解析算。
const READ_TOOLS = new Set(['web_read', 'read_file', 'shell', 'process', 'tool_output_read', 'grep']);

/** 全角半角、换行和空格都不影响比较：原件常有全角数字，解析器会插入空白。 */
export const normalizeText = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();

function record(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const successful = (call: ToolCallFact) => call.status === 'success';

function fetched(calls: readonly ToolCallFact[], pattern: string): boolean {
  const regex = new RegExp(pattern, 'iu');
  return calls.some(call => successful(call) && call.toolName !== 'subagent' && !SEARCH_TOOLS.has(call.toolName)
    && (regex.test(call.arguments) || regex.test(String(record(call.data).url ?? ''))));
}

function evaluateCheck(check: WebAcquisitionCheck, calls: readonly ToolCallFact[]): CheckResult {
  if (check.kind === 'fetch') return { id: check.id, label: check.label, passed: fetched(calls, check.pattern) };
  const needle = normalizeText(check.needle);
  const contentRead = calls.some(call => successful(call) && READ_TOOLS.has(call.toolName) && normalizeText(call.observation).includes(needle));
  const sourceFetched = check.source === undefined || fetched(calls, check.source);
  return { id: check.id, label: check.label, passed: contentRead && sourceFetched, contentRead, sourceFetched };
}

export function evaluateWebAcquisitionRun(task: WebAcquisitionTask, calls: readonly ToolCallFact[], usage: UsageFact): WebAcquisitionRunMetrics {
  const searches = calls.filter(call => SEARCH_TOOLS.has(call.toolName));
  const withArg = (name: string) => searches.filter(call => record(call.arguments)[name] !== undefined).length;
  const reads = calls.filter(call => call.toolName === 'web_read');
  const errors: Record<string, number> = {};
  for (const call of reads) if (call.status === 'error') errors[call.errorCode ?? 'unknown'] = (errors[call.errorCode ?? 'unknown'] ?? 0) + 1;
  return {
    checks: task.checks.map(check => evaluateCheck(check, calls)),
    searches: searches.length,
    searchesWithConditions: { site: withArg('site'), language: withArg('language'), recency: withArg('recency_days'), objective: withArg('objective') },
    reads: {
      ok: reads.filter(successful).length,
      failed: reads.filter(call => call.status === 'error').length,
      truncated: reads.filter(call => successful(call) && record(call.data).truncated === true).length,
      files: reads.filter(call => successful(call) && record(call.data).extractor === 'file_download').length,
      errors,
    },
    shellPdfAttempts: calls.filter(call => (call.toolName === 'shell' || call.toolName === 'process') && /\.pdf\b|pdftotext|pypdf|fitz|pdfjs/iu.test(call.arguments)).length,
    children: calls.filter(call => call.toolName === 'subagent' || (call.toolName === 'web_search' && record(call.arguments).deep_search === true)).length,
    usage,
  };
}
