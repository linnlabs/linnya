import { createHash } from 'node:crypto';
import {
  createBoundaryToken,
  UNTRUSTED_WEB_CONTENT_END_NOTICE,
  UNTRUSTED_WEB_CONTENT_NOTICE_LINES,
  wrapUntrustedWebContentBlock,
} from '../../shared/observation/untrustedWebContent';

export interface WebSearchObservationResult {
  ref: string;
  index: number;
  url: string;
  title: string;
  snippet: string;
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
}): string {
  if (params.results.length === 0) {
    return `No web search results found for "${params.query}".`;
  }

  const boundaryToken = createSearchBoundaryToken(params.results);
  const lines = [
    `Web search results for "${params.query}":`,
    '',
    ...UNTRUSTED_WEB_CONTENT_NOTICE_LINES,
    '',
  ];

  params.results.forEach((result, index) => {
    lines.push(
      `[Result ${result.index}] [@${result.ref}]`,
      `URL: ${result.url}`,
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
