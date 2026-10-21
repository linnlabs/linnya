import {
  ConversationCitationSchema,
  EvidenceResolveToolOutputSchema,
  HistoricalWebResourceReadResultSchema,
  HistoricalWorkspaceReadFileEventResultSchema,
  KnowledgeBaseResourceReadAdmissionResultSchema,
  KnowledgeReadResultSchema,
  KnowledgeSearchCitationSchema,
  KnowledgeSearchResultSchema,
  ResearchRunWriterReplayResultSchema,
  WebReadResultSchema,
  WebSearchResultSchema,
  WorkspaceReadFileEventResultSchema,
  type SearchResultCitation,
  type ConversationCitation,
} from '@app/schemas';

import type { AdmittedConversationCitations } from '../definitions/admittedConversationCitation';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toAdmission(
  citations: readonly ConversationCitation[],
): AdmittedConversationCitations | null {
  if (citations.length === 0) return null;
  return { citations: ConversationCitationSchema.array().parse(citations) };
}

/** 只在 producer 边界转换一次，后续链路不再消费搜索卡片的缩略字段。 */
function admitSearchCitations(
  citations: readonly SearchResultCitation[],
): AdmittedConversationCitations | null {
  return toAdmission(citations.map(citation => {
    if (citation.sourceType === 'knowledge_base') return citation;
    const { author, siteName, ...source } = citation;
    return {
      ...source,
      ...(author ? { authors: [author] } : {}),
      ...(siteName ? { containerTitle: siteName } : {}),
    };
  }));
}

function admitKnowledgeSearchResult(result: unknown): AdmittedConversationCitations | null {
  return admitSearchCitations(
    KnowledgeSearchResultSchema.parse(result).data.citations.citations,
  );
}

function admitResourceReadResult(result: unknown): AdmittedConversationCitations | null {
  if (!isRecord(result) || !isRecord(result.data)) return null;

  if (result.data.source === 'knowledge_base') {
    const parsed = KnowledgeBaseResourceReadAdmissionResultSchema.parse(result);
    return 'citations' in parsed.data
      ? admitSearchCitations(KnowledgeSearchCitationSchema.array().parse(parsed.data.citations.citations))
      : null;
  }
  if (result.data.source === 'web') {
    return admitSearchCitations(
      HistoricalWebResourceReadResultSchema.parse(result).data.citations.citations,
    );
  }
  if (!('citations' in result.data)) return null;
  throw new Error(
    `Unsupported citation-bearing resource_read source: ${String(result.data.source)}`,
  );
}

function admitReadFileResult(result: unknown): AdmittedConversationCitations | null {
  const live = WorkspaceReadFileEventResultSchema.safeParse(result);
  const parsed = live.success
    ? live.data
    : HistoricalWorkspaceReadFileEventResultSchema.parse(result);
  if (!('citations' in parsed.data) || !parsed.data.citations) return null;

  return toAdmission(parsed.data.citations.citations);
}

function admitToolResult(
  toolName: string,
  result: unknown,
): AdmittedConversationCitations | null {
  switch (toolName) {
    case 'knowledge_search':
    case 'search_knowledge_base':
    case 'search_in_knowledgebase':
    case 'search_in_knowledge_base':
      return admitKnowledgeSearchResult(result);
    case 'knowledge_read':
    case 'browse_document_by_chunk':
      return admitSearchCitations(
        KnowledgeReadResultSchema.parse(result).data.citations.citations,
      );
    case 'resource_read':
      return admitResourceReadResult(result);
    case 'evidence_resolve': {
      const parsed = EvidenceResolveToolOutputSchema.parse(result);
      return parsed.data.mode === 'resolve_refs'
        ? admitSearchCitations(parsed.data.citations?.citations ?? [])
        : null;
    }
    case 'research_run_writer':
      return admitSearchCitations(
        ResearchRunWriterReplayResultSchema.parse(result).data.citations?.citations ?? [],
      );
    case 'search_web':
    case 'web_search':
      return admitSearchCitations(WebSearchResultSchema.parse(result).data.citations.citations);
    case 'web_read':
      return admitSearchCitations(WebReadResultSchema.parse(result).data.citations.citations);
    case 'read_file':
      return admitReadFileResult(result);
    default:
      return null;
  }
}

function withAdmissionContext(
  toolName: string,
  admit: () => AdmittedConversationCitations | null,
): AdmittedConversationCitations | null {
  try {
    return admit();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`[CitationAdmission] tool_name=${toolName} 的结果不符合正式合同: ${detail}`);
  }
}

export function admitCitationsFromConversationToolOutput(params: {
  readonly toolName: string;
  readonly status: 'loading' | 'success' | 'error';
  readonly result?: unknown;
}): AdmittedConversationCitations | null {
  if (params.status !== 'success') return null;
  return withAdmissionContext(
    params.toolName,
    () => admitToolResult(params.toolName, params.result),
  );
}

export function admitCitationsFromConversationSubrunOutput(params: {
  readonly toolName: string;
  readonly status: 'loading' | 'success' | 'error';
  readonly output?: unknown;
}): AdmittedConversationCitations | null {
  if (params.status !== 'success') return null;
  return withAdmissionContext(
    params.toolName,
    () => admitToolResult(params.toolName, params.output),
  );
}
