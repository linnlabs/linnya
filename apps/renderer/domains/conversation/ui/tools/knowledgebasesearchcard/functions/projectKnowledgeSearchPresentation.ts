import {
  HistoricalKnowledgeSearchResultSchema,
  KnowledgeSearchArgsSchema,
  KnowledgeSearchResultSchema,
  KnowledgeShallowSearchArgsSchema,
  KnowledgeSearchReplayResultSchema,
  type HistoricalKnowledgeSearchResult,
  type KnowledgeSearchResult,
} from '@app/schemas';
import type {
  ToolCompactStepPresentation,
  ToolCompactStepProjectorInput,
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
  ToolTitleDescriptor,
} from '../../types';
import {
  createConversationToolLocalizedTextDescriptor,
  createConversationToolTitleDescriptor,
} from '../../functions/createConversationToolTitleDescriptor';
import type {
  KnowledgeSearchFilePresentation,
  KnowledgeSearchPresentationData,
  KnowledgeSearchResultsPresentation,
} from '../definitions/knowledgeSearchPresentation';

interface AdmittedKnowledgeSearchRequest {
  readonly query: string;
  readonly requestedDeepSearch: boolean;
  readonly searchMode: 'global' | 'document';
}

/** Subrun 紧凑步骤按 lifecycle 接纳；只有 success 可以读取完整请求与结果。 */
export function projectKnowledgeSearchCompactStep(
  input: ToolCompactStepProjectorInput,
): ToolCompactStepPresentation {
  assertKnowledgeCompactOwner(input.sourceToolName, input.uiKey);
  if (input.status === 'error') {
    return {
      title: createConversationToolLocalizedTextDescriptor(
        'conversation.tool.knowledgeSearch.error',
      ),
    };
  }
  if (input.status === 'loading') {
    const query = readCompactQuery(input.args);
    return {
      title: query
        ? createConversationToolLocalizedTextDescriptor(
            'conversation.tool.knowledgeSearch.compactQuery',
            { query },
          )
        : createConversationToolLocalizedTextDescriptor(
            'conversation.tool.knowledgeSearch.configSearchTitle',
          ),
    };
  }

  const request = admitRequest(input.sourceToolName, input.args);
  KnowledgeSearchReplayResultSchema.parse(input.result);
  return {
    title: createConversationToolLocalizedTextDescriptor(
      'conversation.tool.knowledgeSearch.compactQuery',
      { query: request.query },
    ),
  };
}

function assertKnowledgeCompactOwner(sourceToolName: string, uiKey: string): void {
  const supported = sourceToolName === 'knowledge_search'
    || sourceToolName === 'search_knowledge_base'
    || sourceToolName === 'search_in_knowledgebase'
    || sourceToolName === 'search_in_knowledge_base';
  if (!supported || uiKey !== sourceToolName) {
    throw new Error(
      `Unsupported Knowledge Search compact step: source=${sourceToolName}, uiKey=${uiKey}`,
    );
  }
}

function readCompactQuery(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const query = Reflect.get(value, 'query');
  if (typeof query !== 'string') return undefined;
  const normalized = query.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function projectKnowledgeSearchPresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<KnowledgeSearchPresentationData> {
  if (input.status !== 'success') {
    const request = tryAdmitLifecycleRequest(input.sourceToolName, input.args);
    if (!request) return { data: { kind: 'lifecycle' } };
    return {
      data: { kind: 'lifecycle', ...request },
      title: buildTitle(request.query, null, request.requestedDeepSearch),
    };
  }

  const request = admitRequest(input.sourceToolName, input.args);
  const result = KnowledgeSearchReplayResultSchema.parse(input.result);
  if ('citation_snapshot_bundle_id' in result.data) {
    return {
      data: {
        kind: 'historical-snapshot-pointer',
        query: request.query,
        requestedDeepSearch: request.requestedDeepSearch,
        bundleId: result.data.citation_snapshot_bundle_id,
        count: result.data.count,
      },
      title: buildTitle(request.query, null, request.requestedDeepSearch),
    };
  }

  const data =
    'search_strategy' in result.data
      ? projectCanonicalResult(
          KnowledgeSearchResultSchema.parse(result),
          request.requestedDeepSearch
        )
      : projectHistoricalResult(
          HistoricalKnowledgeSearchResultSchema.parse(result),
          request.requestedDeepSearch
        );
  return {
    data,
    title: buildTitle(data.query, data.docName, data.requestedDeepSearch),
  };
}

function tryAdmitLifecycleRequest(
  sourceToolName: string,
  value: unknown
): AdmittedKnowledgeSearchRequest | undefined {
  if (sourceToolName === 'knowledge_search' || sourceToolName === 'search_knowledge_base') {
    const args = KnowledgeSearchArgsSchema.safeParse(value);
    if (!args.success) return undefined;
    return {
      query: args.data.query,
      requestedDeepSearch: args.data.deep_search,
      searchMode: args.data.doc_id ? 'document' : 'global',
    };
  }
  if (
    sourceToolName === 'search_in_knowledgebase' ||
    sourceToolName === 'search_in_knowledge_base'
  ) {
    const args = KnowledgeShallowSearchArgsSchema.safeParse(value);
    if (!args.success) return undefined;
    return {
      query: args.data.query,
      requestedDeepSearch: false,
      searchMode: args.data.doc_id ? 'document' : 'global',
    };
  }
  throw new Error(`Unsupported Knowledge Search tool: ${sourceToolName}`);
}

/** Citation Snapshot reader 与正常 success admission 共用同一结果投影。 */
export function projectHistoricalKnowledgeSearchResult(
  result: HistoricalKnowledgeSearchResult,
  requestedDeepSearch: boolean
): KnowledgeSearchResultsPresentation {
  return projectHistoricalResult(
    HistoricalKnowledgeSearchResultSchema.parse(result),
    requestedDeepSearch
  );
}

function admitRequest(sourceToolName: string, value: unknown): AdmittedKnowledgeSearchRequest {
  if (sourceToolName === 'knowledge_search' || sourceToolName === 'search_knowledge_base') {
    const args = KnowledgeSearchArgsSchema.parse(value);
    return {
      query: args.query,
      requestedDeepSearch: args.deep_search,
      searchMode: args.doc_id ? 'document' : 'global',
    };
  }
  if (
    sourceToolName === 'search_in_knowledgebase' ||
    sourceToolName === 'search_in_knowledge_base'
  ) {
    const args = KnowledgeShallowSearchArgsSchema.parse(value);
    return {
      query: args.query,
      requestedDeepSearch: false,
      searchMode: args.doc_id ? 'document' : 'global',
    };
  }
  throw new Error(`Unsupported Knowledge Search tool: ${sourceToolName}`);
}

function projectCanonicalResult(
  result: KnowledgeSearchResult,
  requestedDeepSearch: boolean
): KnowledgeSearchResultsPresentation {
  const files = groupMatches(
    result.data.citations.citations
      .filter(citation => citation.isContext !== true)
      .map(citation => ({
        docId: citation.docId,
        docName: citation.docTitle,
        matchId: `${citation.docId}:${citation.blockId}`,
        snippet: citation.snippet,
      }))
  );
  return {
    kind: 'results',
    query: result.data.query,
    requestedDeepSearch,
    actualStrategy: result.data.search_strategy,
    ...(result.data.subrun_id ? { subrunId: result.data.subrun_id } : {}),
    searchMode: result.data.search_mode,
    docName: result.data.doc_name,
    files,
  };
}

function projectHistoricalResult(
  result: HistoricalKnowledgeSearchResult,
  requestedDeepSearch: boolean
): KnowledgeSearchResultsPresentation {
  const files = groupMatches(
    result.data.documents.map(document => ({
      docId: document.doc_id,
      docName: document.doc_name,
      matchId: `${document.doc_id}:${document.block_id}`,
      snippet: document.snippet,
    }))
  );
  return {
    kind: 'results',
    query: result.data.query,
    requestedDeepSearch,
    actualStrategy: requestedDeepSearch ? 'deep' : 'shallow',
    searchMode: result.data.search_mode,
    docName: result.data.doc_name,
    files,
  };
}

function groupMatches(
  items: readonly {
    readonly docId: string;
    readonly docName: string;
    readonly matchId: string;
    readonly snippet: string;
  }[]
): readonly KnowledgeSearchFilePresentation[] {
  const groups = new Map<
    string,
    { docId: string; docName: string; matches: { id: string; snippet: string }[] }
  >();
  for (const item of items) {
    let group = groups.get(item.docId);
    if (!group) {
      group = { docId: item.docId, docName: item.docName, matches: [] };
      groups.set(item.docId, group);
    }
    if (group.matches.length < 2) {
      group.matches.push({ id: item.matchId, snippet: item.snippet });
    }
  }
  return [...groups.values()];
}

function buildTitle(query: string, docName: string | null, deep: boolean): ToolTitleDescriptor {
  const title = docName
    ? createConversationToolTitleDescriptor(
        'conversation.tool.knowledgeSearch.configSearchInDocument',
        { docName }
      )
    : createConversationToolTitleDescriptor(
        'conversation.tool.knowledgeSearch.configSearchKeyword',
        { query }
      );
  if (!deep) return title;
  return {
    ...title,
    tag: {
      text: createConversationToolTitleDescriptor(
        'conversation.tool.knowledgeSearch.actionDeepSearch'
      ).text,
      variant: 'info',
    },
  };
}
