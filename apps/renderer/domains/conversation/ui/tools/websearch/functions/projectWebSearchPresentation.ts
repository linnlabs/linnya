import {
  WebSearchArgsSchema,
  ShallowWebSearchArgsSchema,
  WebSearchResultSchema,
  AssembleWebSourcesArgsSchema,
  AssembleWebSourcesResultSchema,
} from '@app/schemas';
import type {
  ToolCompactStepPresentation,
  ToolCompactStepProjectorInput,
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '../../types';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import {
  toWebSearchDisplayItem,
  type WebSearchPresentationData,
} from '../definitions/webSearchPresentation';

export function projectWebSearchPresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<WebSearchPresentationData> {
  if (
    !['web_search', 'search_web', 'assemble_web_sources'].includes(input.sourceToolName) ||
    input.uiKey !== input.sourceToolName
  )
    throw new Error('Unsupported web search presentation identity');
  if (input.sourceToolName === 'assemble_web_sources') {
    if (input.status !== 'success')
      return {
        data: { kind: 'lifecycle' },
        title: createConversationToolTitleDescriptor('conversation.tool.webSearch.assemble'),
      };
    AssembleWebSourcesArgsSchema.parse(input.args);
    const result = AssembleWebSourcesResultSchema.parse(input.result);
    return {
      data: {
        kind: 'results',
        query: '',
        items: result.data.sources.map(s => toWebSearchDisplayItem(s.citation)),
        materials: {
          summary: result.data.summary,
          notes_truncated: result.data.notes_truncated,
          gaps: result.data.gaps,
          conflicts: result.data.conflicts,
          failures: result.data.failures,
          search_count: result.data.search_count,
          read_attempt_count: result.data.read_attempt_count,
          source_notes: result.data.sources.map(({ citation, ...note }) => ({
            ...note,
            ref: citation.ref,
          })),
        },
      },
      title: createConversationToolTitleDescriptor('conversation.tool.webSearch.assemble'),
    };
  }
  const argsSchema =
    input.sourceToolName === 'search_web' ? ShallowWebSearchArgsSchema : WebSearchArgsSchema;
  const args = argsSchema.safeParse(input.args);
  const deep = args.success && 'deep_search' in args.data && args.data.deep_search === true;
  const title = createConversationToolTitleDescriptor(
    deep
      ? 'conversation.tool.webSearch.deepTitle'
      : 'conversation.tool.webSearch.configTitleWithQuery',
    { query: args.success ? args.data.query : '' }
  );
  if (input.status !== 'success')
    return { data: { kind: 'lifecycle', requestedDeepSearch: deep }, title };
  if (!args.success) throw args.error;
  const result = WebSearchResultSchema.parse(input.result);
  if (result.data.query !== args.data.query)
    throw new Error('Web search result query does not match its tool arguments.');
  const data = result.data;
  return {
    data: {
      kind: 'results',
      query: data.query,
      requestedDeepSearch: deep,
      strategy: data.search_strategy ?? 'shallow',
      items: data.citations.citations.map(toWebSearchDisplayItem),
      subrunIds: data.subrun_ids,
      materials: data.research,
      limited: data.downgrade_reason === 'deep_search_limit',
    },
    title:
      data.search_strategy === 'deep'
        ? title
        : createConversationToolTitleDescriptor(
            'conversation.tool.webSearch.configTitleWithQuery',
            { query: data.query }
          ),
  };
}
export function projectWebSearchCompactStep(
  input: ToolCompactStepProjectorInput
): ToolCompactStepPresentation {
  if (
    !['web_search', 'search_web', 'assemble_web_sources'].includes(input.sourceToolName) ||
    input.uiKey !== input.sourceToolName
  )
    throw new Error('Unsupported web search compact presentation identity');
  if (input.status === 'error')
    return {
      title: createConversationToolTitleDescriptor('conversation.tool.webSearch.failed').text,
    };
  if (input.sourceToolName === 'assemble_web_sources') {
    if (input.status === 'success') AssembleWebSourcesArgsSchema.parse(input.args);
    return {
      title: createConversationToolTitleDescriptor('conversation.tool.webSearch.assemble').text,
    };
  }
  const args =
    input.sourceToolName === 'search_web'
      ? ShallowWebSearchArgsSchema.safeParse(input.args)
      : WebSearchArgsSchema.safeParse(input.args);
  if (!args.success && input.status === 'success') throw args.error;
  if (args.success && 'deep_search' in args.data && args.data.deep_search === true) {
    return {
      title: createConversationToolTitleDescriptor('conversation.tool.webSearch.deepTitle', {
        query: args.data.query,
      }).text,
    };
  }
  return {
    title: args.success
      ? createConversationToolTitleDescriptor('conversation.tool.webSearch.compactQuery', {
          query: args.data.query,
        }).text
      : createConversationToolTitleDescriptor('conversation.tool.webSearch.configTitle').text,
  };
}
