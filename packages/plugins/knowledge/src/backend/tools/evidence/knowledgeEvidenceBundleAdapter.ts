import type { ToolContext } from '@plugin/backend/toolRuntime';
import { captureKnowledgeCitationEvidence } from '@plugin/backend/citationSourceRuntime';
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
  await captureKnowledgeCitationEvidence(params);
}
