import type { ToolContext } from '../../types';
import { saveEvidenceBundleFromToolContext } from '../../evidence/evidenceBundleToolContextAdapter';
import type { KnowledgeEvidenceCaptureItem } from '../definitions/knowledgeEvidenceCapture';

/**
 * Knowledge owner DTO → Evidence write command 的唯一工具组合边界。
 * Knowledge feature 和 capture builder 不得认识 Evidence 的存储字段。
 */
export async function saveKnowledgeEvidenceCapture(params: {
  readonly context: ToolContext;
  readonly query: string;
  readonly items: readonly KnowledgeEvidenceCaptureItem[];
}): Promise<void> {
  await saveEvidenceBundleFromToolContext({
    context: params.context,
    kind: 'knowledge_evidence',
    query: params.query,
    items: params.items.map((item) => ({
      ref_id: item.ref,
      source_type: 'knowledge_base',
      title: item.title,
      snippet: item.snippet,
      content_text: item.contentText,
      captured_at_ms: item.capturedAtMs,
      capture_kind: item.captureKind,
      doc_id: item.documentId,
      block_id: item.blockId,
      ...(item.documentName ? { doc_name: item.documentName } : {}),
    })),
  });
}
