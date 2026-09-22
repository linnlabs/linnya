import {
  AssembleWebSourcesResultSchema,
  DeepWebSearchResultSchema,
  PromptKeys,
  type WebSearchArgs,
} from '@app/schemas';
import type { ToolContext } from '../../../../types';
import { runRegisteredSubagent } from '../../../../agent_control/subrun/shared';
import { requireCitationSequenceOffset } from 'src/domains/citation';
import { buildDeepWebObservation } from '../functions/buildDeepWebObservation';

export async function runDeepWebSearch(args: WebSearchArgs, context: ToolContext): Promise<string> {
  if (context.abortSignal?.aborted)
    throw new DOMException('The request was aborted.', 'AbortError');
  if (!context.modelId) throw new Error('Deep web search requires the parent model identity.');
  const result = await runRegisteredSubagent({
    context,
    promptKey: PromptKeys.DEEP_WEB_SEARCH,
    description: args.query,
    userMessage: JSON.stringify(args),
    inheritTurns: 0,
    maxSteps: 30,
    modelId: context.modelId,
    subrunSource: 'tool:web_search:deep_search',
    subrunMetadata: {},
  });
  if (context.abortSignal?.aborted || result.cancelled)
    throw new DOMException('The child request was cancelled.', 'AbortError');
  if (!result.success || !result.judgeToolOutput)
    throw new Error(
      'Deep web search did not produce a valid source assembly. No ordinary-search fallback was performed.'
    );
  const assembled = AssembleWebSourcesResultSchema.parse(JSON.parse(result.judgeToolOutput));
  const offset = requireCitationSequenceOffset(context);
  const materials = {
    ...assembled.data,
    sources: assembled.data.sources.map((source, index) => ({
      ...source,
      citation: { ...source.citation, index: offset + index + 1 },
    })),
  };
  if (materials.sources.length > args.top_k)
    throw new Error('Deep search selection exceeded top_k.');
  return JSON.stringify(
    DeepWebSearchResultSchema.parse({
      data: {
        query: args.query,
        search_strategy: 'deep',
        subrun_ids: [result.subrunId],
        resultCount: materials.sources.length,
        citations: {
          query: args.query,
          searchMode: 'web',
          citations: materials.sources.map(s => s.citation),
        },
        evidence_store: materials.evidence_store,
        research: {
          summary: materials.summary,
          notes_truncated: materials.notes_truncated,
          source_notes: materials.sources.map(({ citation, ...note }) => ({
            ...note,
            ref: citation.ref,
          })),
          gaps: materials.gaps,
          conflicts: materials.conflicts,
          failures: materials.failures,
          search_count: materials.search_count,
          read_attempt_count: materials.read_attempt_count,
        },
      },
      observation: buildDeepWebObservation(args.query, materials),
    })
  );
}
