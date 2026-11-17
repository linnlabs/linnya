/**
 * @file buildShallowKnowledgeSearchEvidenceCapture.ts
 * @description 把 shallow Knowledge Search owner result 投影为 Knowledge capture DTO。
 */

import type { KnowledgeSearchResult } from '@app/schemas';
import type { KnowledgeEvidenceCaptureItem } from '../../definitions/knowledgeEvidenceCapture';

export interface ShallowKnowledgeSearchEvidenceCapture {
  readonly query: string;
  readonly items: readonly KnowledgeEvidenceCaptureItem[];
}

export function buildShallowKnowledgeSearchEvidenceCapture(params: {
  readonly result: KnowledgeSearchResult;
  readonly capturedAtMs: number;
}): ShallowKnowledgeSearchEvidenceCapture {
  if (params.result.data.search_strategy !== 'shallow') {
    throw new Error('[knowledge_search] shallow Evidence adapter 收到了 deep search 结果。');
  }

  const items = params.result.data.citations.citations.map(
    (citation, index): KnowledgeEvidenceCaptureItem => {
      if (!citation.snippet) {
        throw new Error(`[knowledge_search] 第 ${index + 1} 条 citation 没有可持久化的 snippet。`);
      }
      if (!params.result.observation.includes(`[@${citation.ref}]`)) {
        throw new Error(
          `[knowledge_search] 第 ${index + 1} 条 canonical ref 未出现在 AI observation。`
        );
      }
      const sourceAnchor = `doc_id='${citation.docId}', block_id='${citation.blockId}'`;
      if (!params.result.observation.includes(sourceAnchor)) {
        throw new Error(
          `[knowledge_search] 第 ${index + 1} 条 citation 来源锚点未出现在 AI observation。`
        );
      }

      return {
        ref: citation.ref,
        title: citation.docTitle,
        snippet: citation.snippet,
        contentText: citation.snippet,
        capturedAtMs: params.capturedAtMs,
        captureKind: 'knowledge_search_result',
        documentId: citation.docId,
        blockId: citation.blockId,
        documentName: citation.docTitle,
      };
    }
  );

  return {
    query: params.result.data.query,
    items,
  };
}
