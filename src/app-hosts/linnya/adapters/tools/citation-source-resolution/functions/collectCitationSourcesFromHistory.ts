import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import { admitCitationsFromConversationToolOutput } from 'src/domains/citation/conversation-presentation';
import {
  normalizeCitationWebUrl,
  projectSearchResultCitationSource,
  type CitationSource,
} from 'src/domains/citation';

function toResult(event: Extract<RuntimeEvent, { type: 'tool_output' }>): {
  readonly data: unknown;
  readonly observation: string;
} {
  return { data: event.data, observation: event.observation };
}

function readOwnerSources(
  event: Extract<RuntimeEvent, { type: 'tool_output' }>
): readonly CitationSource[] {
  const admitted = admitCitationsFromConversationToolOutput({
    toolName: event.tool_name,
    status: event.status,
    result: toResult(event),
  });
  return admitted?.citations.map(projectSearchResultCitationSource) ?? [];
}

/**
 * 从当前 working history 的正式 producer data 中收集来源快照。
 * 事件按时间倒序读取，使同一锚点优先使用 Agent 最近一次实际看见的快照。
 */
export function collectCitationSourcesFromHistory(params: {
  readonly events: readonly RuntimeEvent[];
  readonly requestedRefs?: readonly string[];
  readonly requestedUrls?: readonly string[];
}): readonly CitationSource[] {
  const requestedRefs = params.requestedRefs ? new Set(params.requestedRefs) : null;
  const requestedUrls = params.requestedUrls
    ? new Set(params.requestedUrls.map(normalizeCitationWebUrl))
    : null;
  if (!requestedRefs && !requestedUrls) {
    throw new Error('Citation history collection requires refs or URLs.');
  }
  const result: CitationSource[] = [];

  for (let index = params.events.length - 1; index >= 0; index -= 1) {
    const event = params.events[index];
    if (!event || event.type !== 'tool_output' || event.status !== 'success') continue;
    const sources = readOwnerSources(event);
    for (const source of sources) {
      const matchesRef = requestedRefs?.has(source.ref) ?? false;
      const matchesUrl =
        requestedUrls !== null &&
        source.sourceType === 'web' &&
        requestedUrls.has(normalizeCitationWebUrl(source.url));
      if (matchesRef || matchesUrl) result.push(source);
    }
  }

  return result;
}
