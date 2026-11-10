import { createHash } from 'node:crypto';
import {
  createBoundaryToken,
  UNTRUSTED_WEB_CONTENT_END_NOTICE,
  UNTRUSTED_WEB_CONTENT_NOTICE_LINES,
  wrapUntrustedWebContentBlock,
} from '../../shared/observation/untrustedWebContent';
import type { WebSearchConditionReport } from '../providers/types';

export interface WebSearchObservationResult {
  ref: string;
  index: number;
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
}

const EXECUTION_TEXT: Record<WebSearchConditionReport['execution'], string> = {
  applied: 'applied',
  preference: 'preference only; results may not match',
  unsupported: 'not supported by this search service; ignored',
};

/**
 * 发布日期来自上游，只接受能解析成日历日期的值并统一成 YYYY-MM-DD，
 * 避免任意上游文本绕过不可信块进入可信骨架。
 */
export function normalizePublishedDate(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text || text.length > 64) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/u.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (!/\b\d{4}\b/u.test(text)) return undefined;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

function describeConditions(conditions: ReadonlyArray<WebSearchConditionReport> | undefined): string[] {
  if (!conditions?.length) return [];
  return [
    'Search conditions:',
    ...conditions.map(({ condition, value, execution, detail }) =>
      `- ${condition}=${value}: ${EXECUTION_TEXT[execution]}${detail ? ` (${detail})` : ''}`),
    '',
  ];
}

function createSearchBoundaryToken(results: ReadonlyArray<WebSearchObservationResult>): string {
  const untrustedContent = results
    .map((result) => `${result.title}\n${result.snippet}`)
    .join('\n\n');
  const contentHash = createHash('sha256').update(untrustedContent, 'utf8').digest('hex');
  return createBoundaryToken(contentHash);
}

/**
 * 搜索结果的 ref、序号和 URL 是可信引用骨架，必须留在隔离边界外。
 * 只有来自上游的标题和摘要进入不可信块，避免伪造 ref 与真实引用混淆。
 */
export function buildWebSearchObservation(params: {
  query: string;
  results: ReadonlyArray<WebSearchObservationResult>;
  /** 本次带了条件时才给；服务没报告执行情况时整体标为未报告。 */
  conditions?: ReadonlyArray<WebSearchConditionReport>;
  conditionsUnreported?: boolean;
}): string {
  const conditionLines = params.conditionsUnreported
    ? ['Search conditions: this search service does not report how site, time or language were applied.', '']
    : describeConditions(params.conditions);
  if (params.results.length === 0) {
    return [...conditionLines, `No web search results found for "${params.query}".`].join('\n');
  }

  const boundaryToken = createSearchBoundaryToken(params.results);
  const lines = [
    `Web search results for "${params.query}":`,
    '',
    ...conditionLines,
    ...UNTRUSTED_WEB_CONTENT_NOTICE_LINES,
    '',
  ];

  params.results.forEach((result, index) => {
    const date = normalizePublishedDate(result.publishedAt);
    lines.push(
      `[Result ${result.index}] [@${result.ref}]`,
      `URL: ${result.url}`,
      ...(date ? [`Published: ${date} (reported by the search service; not verified against the page)`] : []),
      ...wrapUntrustedWebContentBlock({
        token: boundaryToken,
        body: `${result.title}\n${result.snippet}`,
      }),
    );
    if (index < params.results.length - 1) lines.push('');
  });

  lines.push(UNTRUSTED_WEB_CONTENT_END_NOTICE);
  return lines.join('\n');
}
