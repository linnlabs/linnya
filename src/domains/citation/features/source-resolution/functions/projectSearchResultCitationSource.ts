import type { SearchResultCitation } from '@app/schemas';

import type { CitationSource } from '../definitions/citationSource';

/**
 * 将 Conversation producer 的标准引用事实投影为文档写入所需的来源快照。
 * producer 准入由 conversation-presentation feature 负责；这里仅转换 Citation domain
 * 内两种公开契约，避免 App Host 再次识别各工具的私有结果形状。
 */
export function projectSearchResultCitationSource(citation: SearchResultCitation): CitationSource {
  if (citation.sourceType === 'knowledge_base') {
    return {
      sourceType: citation.sourceType,
      ref: citation.ref,
      docId: citation.docId,
      blockId: citation.blockId,
      title: citation.docTitle,
      snippet: citation.snippet,
    };
  }

  return {
    sourceType: citation.sourceType,
    ref: citation.ref,
    url: citation.url,
    title: citation.docTitle,
    snippet: citation.snippet,
    ...(citation.author ? { authors: [citation.author] } : {}),
    ...(citation.publishedAt ? { publishedAt: citation.publishedAt } : {}),
    ...(citation.siteName ? { containerTitle: citation.siteName } : {}),
  };
}
