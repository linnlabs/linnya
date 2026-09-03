import { WebSearchArgsSchema, WebSearchResultSchema } from '@app/schemas';
import type {
  ToolCompactStepPresentation,
  ToolCompactStepProjectorInput,
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '../../types';
import {
  createConversationToolLocalizedTextDescriptor,
  createConversationToolTitleDescriptor,
} from '../../functions/createConversationToolTitleDescriptor';
import {
  toWebSearchDisplayItem,
  type WebSearchPresentationData,
} from '../definitions/webSearchPresentation';

export function projectWebSearchCompactStep(
  input: ToolCompactStepProjectorInput,
): ToolCompactStepPresentation {
  if (input.sourceToolName !== 'web_search' || input.uiKey !== 'web_search') {
    throw new Error(
      `Unsupported Web search compact step: source=${input.sourceToolName}, uiKey=${input.uiKey}`,
    );
  }
  if (input.status === 'error') {
    return {
      title: createConversationToolLocalizedTextDescriptor(
        'conversation.tool.webSearch.failed',
      ),
    };
  }
  if (input.status === 'loading') {
    const query = readCompactQuery(input.args);
    return {
      title: query
        ? createConversationToolLocalizedTextDescriptor(
            'conversation.tool.webSearch.compactQuery',
            { query },
          )
        : createConversationToolLocalizedTextDescriptor(
            'conversation.tool.webSearch.configTitle',
          ),
    };
  }
  const args = WebSearchArgsSchema.parse(input.args);
  const result = WebSearchResultSchema.parse(input.result);
  if (result.data.query !== args.query) {
    throw new Error('Web search compact result query does not match its tool arguments.');
  }
  return {
    title: createConversationToolLocalizedTextDescriptor(
      'conversation.tool.webSearch.compactQuery',
      { query: args.query },
    ),
  };
}

function readCompactQuery(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const query = Reflect.get(value, 'query');
  if (typeof query !== 'string') return undefined;
  const normalized = query.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function projectWebSearchPresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<WebSearchPresentationData> {
  if (input.sourceToolName !== 'web_search' || input.uiKey !== 'web_search') {
    throw new Error(
      `Unsupported Web search presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`
    );
  }

  if (input.status !== 'success') {
    const lifecycleArgs = WebSearchArgsSchema.safeParse(input.args);
    return {
      data: { kind: 'lifecycle' },
      title: lifecycleArgs.success
        ? createConversationToolTitleDescriptor(
            'conversation.tool.webSearch.configTitleWithQuery',
            { query: lifecycleArgs.data.query }
          )
        : createConversationToolTitleDescriptor('conversation.tool.webSearch.configTitle'),
    };
  }

  const args = WebSearchArgsSchema.parse(input.args);
  const title = createConversationToolTitleDescriptor(
    'conversation.tool.webSearch.configTitleWithQuery',
    { query: args.query }
  );
  const result = WebSearchResultSchema.parse(input.result);
  if (result.data.query !== args.query) {
    throw new Error('Web search result query does not match its tool arguments.');
  }
  return {
    data: {
      kind: 'results',
      query: result.data.query,
      items: result.data.citations.citations.map(toWebSearchDisplayItem),
    },
    title,
  };
}
