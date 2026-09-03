import { describe, expect, it } from 'vitest';
import { BlockType } from '../../../../features/knowledge-base/domain/block';
import type { OrderedKnowledgeDocumentBlock } from '../../../../features/knowledge-base/document-read/definitions/knowledgeDocumentRead';
import {
  buildKnowledgeDocumentReadResult,
  selectKnowledgeDocumentReadBlocks,
} from '../../../../features/knowledge-base/document-read/functions/buildKnowledgeDocumentReadResult';
import { buildKnowledgeReadEvidenceCapture } from './buildKnowledgeReadEvidenceCapture';

function createResult() {
  const request = {
    documentId: 'document-1',
    startChunk: 1,
    endChunk: 2,
    mode: 'full' as const,
    citationOffset: 4,
  };
  const orderedBlocks: OrderedKnowledgeDocumentBlock[] = [
    {
      blockId: 'block-1',
      block: { block_type: BlockType.PARAGRAPH, text: '模型看到的第一段全文。' },
    },
    {
      blockId: 'block-2',
      block: { block_type: BlockType.PARAGRAPH, text: '模型看到的第二段全文。' },
    },
  ];
  return buildKnowledgeDocumentReadResult({
    filename: '研究报告.docx',
    selection: selectKnowledgeDocumentReadBlocks({ request, orderedBlocks }),
    citationRefs: ['Abc234', 'Def567'],
  });
}

describe('buildKnowledgeReadEvidenceCapture', () => {
  it('只按 observation 中同位的 canonical refs 捕获模型实际阅读的 chunk', () => {
    const result = createResult();
    const capture = buildKnowledgeReadEvidenceCapture({
      documentId: 'document-1',
      result,
      capturedAtMs: 100,
    });

    expect(capture.items).toEqual(
      result.data.chunks.map((chunk, index) =>
        expect.objectContaining({
          ref: result.data.citations.citations[index]?.ref,
          documentId: 'document-1',
          blockId: `block-${index + 1}`,
          contentText: chunk.text,
          captureKind: 'knowledge_document_chunk',
          capturedAtMs: 100,
        })
      )
    );
  });

  it('owner citation 与 observation canonical header 不一致时明确失败', () => {
    const result = createResult();
    const firstCitation = result.data.citations.citations[0];
    if (!firstCitation) throw new Error('测试读取结果缺少 citation');

    expect(() =>
      buildKnowledgeReadEvidenceCapture({
        documentId: 'document-1',
        result: {
          ...result,
          data: {
            ...result.data,
            citations: {
              ...result.data.citations,
              citations: [
                { ...firstCitation, ref: 'ABC234' },
                ...result.data.citations.citations.slice(1),
              ],
            },
          },
        },
        capturedAtMs: 100,
      })
    ).toThrow('citation 与 observation 的 canonical header 不一致');
  });
});
