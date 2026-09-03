import type { RuntimeEvent } from 'linnkit/contracts';
import { admitCitationsFromConversationToolOutput } from 'src/domains/citation/conversation-presentation';
import { projectSearchResultCitationSource, type CitationSource } from 'src/domains/citation';

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
  readonly requestedRefs: readonly string[];
}): readonly CitationSource[] {
  const requested = new Set(params.requestedRefs);
  const result: CitationSource[] = [];

  for (let index = params.events.length - 1; index >= 0; index -= 1) {
    const event = params.events[index];
    if (!event || event.type !== 'tool_output' || event.status !== 'success') continue;
    const sources = readOwnerSources(event);
    for (const source of sources) {
      if (requested.has(source.ref)) result.push(source);
    }
  }

  return result;
}
