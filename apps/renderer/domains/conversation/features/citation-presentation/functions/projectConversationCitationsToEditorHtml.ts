/** 将 Conversation 引用 DOM 投影为 Editor CitationNode 的公开 HTML 协议。 */
import type { ConversationCitation } from '@app/schemas';

export interface ConversationCitationEditorProjectionStats {
  total: number;
  hydrated: number;
  missing: Array<{ turnId: string; ref: string }>;
}

export interface ProjectConversationCitationsToEditorHtmlParams {
  renderedHtml: string;
  findCitationByRef: (turnId: string, ref: string) => ConversationCitation | null;
  generateCitationId: () => string;
}

export interface ProjectConversationCitationsToEditorHtmlResult {
  html: string;
  stats: ConversationCitationEditorProjectionStats;
}

export function projectConversationCitationsToEditorHtml(
  params: ProjectConversationCitationsToEditorHtmlParams
): ProjectConversationCitationsToEditorHtmlResult {
  const { renderedHtml, findCitationByRef, generateCitationId } = params;
  const stats: ConversationCitationEditorProjectionStats = {
    total: 0,
    hydrated: 0,
    missing: [],
  };
  if (!renderedHtml.trim()) return { html: renderedHtml, stats };

  const document = new DOMParser().parseFromString(renderedHtml, 'text/html');
  const citationNodes = document.querySelectorAll<HTMLElement>('[data-citation-ref][data-turn-id]');
  stats.total = citationNodes.length;

  for (const sourceElement of citationNodes) {
    const ref = sourceElement.dataset.citationRef;
    const turnId = sourceElement.dataset.turnId;
    if (!ref || !turnId) continue;

    const citation = findCitationByRef(turnId, ref);
    if (!citation) {
      stats.missing.push({ turnId, ref });
      continue;
    }

    const sourceId = citation.sourceType === 'web' ? citation.url : citation.docId;
    const nodeElement = document.createElement('span');
    nodeElement.className = 'citation-mark';
    nodeElement.dataset.type = 'citation';
    nodeElement.dataset.citationId = generateCitationId();
    nodeElement.dataset.citationRef = ref;
    nodeElement.dataset.sourceType = citation.sourceType;
    nodeElement.dataset.sourceId = sourceId;
    nodeElement.dataset.title = citation.docTitle;
    nodeElement.dataset.snippet = citation.snippet;

    if (citation.sourceType === 'knowledge_base') {
      nodeElement.dataset.blockId = citation.blockId;
      if (citation.kbId) nodeElement.dataset.kbId = citation.kbId;
    } else {
      nodeElement.dataset.url = citation.url;
      if (citation.publishedAt) nodeElement.dataset.date = citation.publishedAt;
      // 展示可只取首位作者，但跨文档传递必须使用完整快照，不能从显示文本反推。
      if (citation.authors) nodeElement.dataset.authors = JSON.stringify(citation.authors);
      if (citation.containerTitle) nodeElement.dataset.containerTitle = citation.containerTitle;
    }

    // HTML 的文本内容也是可移植边界协议，不保存 Conversation 当时的派生编号。
    nodeElement.textContent = `[@${ref}]`;
    sourceElement.replaceWith(nodeElement);
    stats.hydrated += 1;
  }

  return { html: document.body.innerHTML, stats };
}
