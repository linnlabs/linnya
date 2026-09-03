/**
 * Knowledge Read owner result → Evidence 的 app/tool 编排。
 *
 * Knowledge feature 不依赖 Evidence 存储；本文件只组合 owner capture builder
 * 与唯一 Evidence adapter。bundle 身份不回流到 Knowledge 工具结果。
 */

import type { KnowledgeDocumentReadResult } from '../../../features/knowledge-base/document-read/definitions/knowledgeDocumentRead';
import type { ToolContext } from '../../types';
import { saveKnowledgeEvidenceCapture } from '../evidence/knowledgeEvidenceBundleAdapter';
import { buildKnowledgeReadEvidenceCapture } from './functions/buildKnowledgeReadEvidenceCapture';

export async function captureKnowledgeReadEvidence(params: {
  readonly documentId: string;
  readonly result: KnowledgeDocumentReadResult;
  readonly context: ToolContext;
}): Promise<void> {
  const capture = buildKnowledgeReadEvidenceCapture({
    documentId: params.documentId,
    result: params.result,
    capturedAtMs: Date.now(),
  });

  await saveKnowledgeEvidenceCapture({
    context: params.context,
    query: capture.query,
    items: capture.items,
  });
}
