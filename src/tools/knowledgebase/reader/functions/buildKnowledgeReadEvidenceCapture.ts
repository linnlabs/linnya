/**
 * @file buildKnowledgeReadEvidenceCapture.ts
 * @description 把 Knowledge owner result 投影为 Knowledge capture DTO。
 */

import type { KnowledgeDocumentReadResult } from '../../../../features/knowledge-base/document-read/definitions/knowledgeDocumentRead';
import type { KnowledgeEvidenceCaptureItem } from '../../definitions/knowledgeEvidenceCapture';

export interface KnowledgeReadEvidenceCapture {
  readonly query: string;
  readonly items: readonly KnowledgeEvidenceCaptureItem[];
}

function assertCitationHeadersMatchOwnerResult(params: {
  readonly observation: string;
  readonly chunks: readonly { readonly index: number }[];
  readonly totalChunks: number;
  readonly citationRefs: readonly string[];
}): void {
  let previousHeaderIndex = -1;
  for (const [index, ref] of params.citationRefs.entries()) {
    const chunk = params.chunks[index];
    if (!chunk) {
      throw new Error(`[knowledge_read] 第 ${index + 1} 条 citation 缺少同位 chunk。`);
    }
    const header = `[Chunk ${chunk.index}/${params.totalChunks}] [@${ref}]`;
    const headerIndex = params.observation.indexOf(header, previousHeaderIndex + 1);
    if (headerIndex < 0) {
      throw new Error(
        `[knowledge_read] 第 ${index + 1} 条 citation 与 observation 的 canonical header 不一致。`
      );
    }
    previousHeaderIndex = headerIndex;
  }
}

/**
 * Knowledge reader 只能持久化本次真正交给 Agent 的内容。
 * chunks 与 citations 都由 owner schema 接纳后再进入这里；本函数仍显式校验二者的同位关系，
 * 避免后续字段演进把错误来源锚点永久写入 Evidence。
 */
export function buildKnowledgeReadEvidenceCapture(params: {
  readonly documentId: string;
  readonly result: KnowledgeDocumentReadResult;
  readonly capturedAtMs: number;
}): KnowledgeReadEvidenceCapture {
  const { data } = params.result;
  const citations = data.citations.citations;
  if (data.chunks.length !== citations.length) {
    throw new Error('[knowledge_read] chunks 与 citations 数量不一致，无法持久化引用证据。');
  }

  const citationRefs = citations.map((citation, index) => {
    if (citation.sourceType !== 'knowledge_base') {
      throw new Error(`[knowledge_read] 第 ${index + 1} 条 citation 不是 Knowledge 来源。`);
    }
    if (citation.docId !== params.documentId) {
      throw new Error(`[knowledge_read] 第 ${index + 1} 条 citation 的 docId 与读取目标不一致。`);
    }
    if (!citation.blockId) {
      throw new Error(`[knowledge_read] 第 ${index + 1} 条 citation 缺少 blockId。`);
    }
    if (!citation.ref) {
      throw new Error(`[knowledge_read] 第 ${index + 1} 条 citation 缺少 canonical ref。`);
    }
    return citation.ref;
  });

  assertCitationHeadersMatchOwnerResult({
    observation: params.result.observation,
    chunks: data.chunks,
    totalChunks: data.total_chunks,
    citationRefs,
  });

  const items = data.chunks.map((chunk, index): KnowledgeEvidenceCaptureItem => {
    const citation = citations[index];
    if (!citation?.ref || !citation.blockId || citation.docId !== params.documentId) {
      throw new Error(`[knowledge_read] 第 ${index + 1} 个 chunk 缺少已接纳的引用来源。`);
    }
    if (citation.docTitle !== data.filename) {
      throw new Error(`[knowledge_read] 第 ${index + 1} 条 citation 的标题与读取文档不一致。`);
    }
    if (citation.snippet !== chunk.text.slice(0, 100)) {
      throw new Error(`[knowledge_read] 第 ${index + 1} 条 citation snippet 与 chunk 内容不一致。`);
    }
    if (!chunk.text) {
      throw new Error(`[knowledge_read] 第 ${index + 1} 个 chunk 没有可持久化的文本。`);
    }

    return {
      ref: citation.ref,
      title: data.filename,
      snippet: chunk.text,
      contentText: chunk.text,
      capturedAtMs: params.capturedAtMs,
      captureKind:
        data.mode === 'full' ? 'knowledge_document_chunk' : 'knowledge_document_preview',
      documentId: params.documentId,
      blockId: citation.blockId,
      documentName: data.filename,
    };
  });

  return {
    query: data.citations.query,
    items,
  };
}
