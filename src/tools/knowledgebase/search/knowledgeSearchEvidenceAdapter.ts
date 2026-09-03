/**
 * Knowledge Search owner result → Evidence 的 app/tool 编排。
 *
 * 两个 shallow facade 共用 runner，因此只在 runner 的 owner-result 边界捕获一次。
 * 本文件只组合 Knowledge capture builder 与唯一 Evidence adapter；空结果不制造 bundle。
 */

import type { KnowledgeSearchResult } from '@app/schemas';
import type { ToolContext } from '../../types';
import { saveKnowledgeEvidenceCapture } from '../evidence/knowledgeEvidenceBundleAdapter';
import { buildShallowKnowledgeSearchEvidenceCapture } from './functions/buildShallowKnowledgeSearchEvidenceCapture';
import type { DeepSearchEmittedEvidence } from './format/formatObservation';

export async function captureShallowKnowledgeSearchEvidence(params: {
  readonly result: KnowledgeSearchResult;
  readonly context: ToolContext;
}): Promise<void> {
  const capture = buildShallowKnowledgeSearchEvidenceCapture({
    result: params.result,
    capturedAtMs: Date.now(),
  });
  if (capture.items.length === 0) return;

  await saveKnowledgeEvidenceCapture({
    context: params.context,
    query: capture.query,
    items: capture.items,
  });
}

export async function captureDeepKnowledgeSearchEvidence(params: {
  readonly query: string;
  readonly emittedEvidence: readonly DeepSearchEmittedEvidence[];
  readonly context: ToolContext;
}): Promise<void> {
  if (params.emittedEvidence.length === 0) return;
  const capturedAtMs = Date.now();

  await saveKnowledgeEvidenceCapture({
    context: params.context,
    query: params.query,
    items: params.emittedEvidence.map(item => ({
      ref: item.ref,
      title: item.docTitle,
      snippet: item.text,
      contentText: item.text,
      capturedAtMs,
      captureKind: 'knowledge_document_chunk',
      documentId: item.docId,
      blockId: item.blockId,
      documentName: item.docTitle,
    })),
  });
}
