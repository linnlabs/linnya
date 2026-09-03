import { describe, expect, it, vi } from 'vitest';
import { BlockType, type DocumentSoT } from '../../domain/block';
import { createDocument } from '../../domain/document';
import { readKnowledgeDocumentByChunks } from './readKnowledgeDocumentByChunks';

function createSourceOfTruth(): DocumentSoT {
  return {
    doc_id: 'doc_1',
    doc_title: '研究报告',
    metadata: {},
    content_blocks: {
      block_2: { block_type: BlockType.PARAGRAPH, text: '第二段' },
      block_1: { block_type: BlockType.PARAGRAPH, text: '第一段' },
    },
    structure: {
      root: ['block_1', 'block_2'],
    },
  };
}

describe('readKnowledgeDocumentByChunks', () => {
  it('应先按文档所属知识库授权，再按 SoT root 顺序生成阅读结果', async () => {
    const assertDocumentAllowed = vi.fn();
    const result = await readKnowledgeDocumentByChunks(
      {
        documentId: 'doc_1',
        startChunk: 1,
        endChunk: 2,
        mode: 'full',
        citationOffset: 0,
      },
      {
        reader: {
          getDocumentById: async () => createDocument('doc_1', 'kb_1', '研究报告.docx', 100),
          getRawSoTDocument: async () => createSourceOfTruth(),
        },
        assertDocumentAllowed,
        citationRefAllocator: {
          async allocate(anchors) {
            return anchors.map((_, index) => (index === 0 ? 'Abc234' : 'Def567'));
          },
        },
      }
    );

    expect(assertDocumentAllowed).toHaveBeenCalledWith('kb_1', 'doc_1');
    expect(result.data.chunks).toEqual([
      { index: 1, text: '第一段' },
      { index: 2, text: '第二段' },
    ]);
    expect(result.data.citations.citations.map(citation => citation.blockId)).toEqual([
      'block_1',
      'block_2',
    ]);
  });

  it('授权失败时不应继续读取 SoT', async () => {
    const getRawSoTDocument = vi.fn(async () => createSourceOfTruth());

    await expect(
      readKnowledgeDocumentByChunks(
        {
          documentId: 'doc_1',
          startChunk: 1,
          endChunk: 1,
          mode: 'full',
          citationOffset: 0,
        },
        {
          reader: {
            getDocumentById: async () =>
              createDocument('doc_1', 'kb_forbidden', '研究报告.docx', 100),
            getRawSoTDocument,
          },
          assertDocumentAllowed: () => {
            throw new Error('禁止跨项目读取知识库文档');
          },
          citationRefAllocator: {
            async allocate() {
              return ['Abc234'];
            },
          },
        }
      )
    ).rejects.toThrow('禁止跨项目读取知识库文档');

    expect(getRawSoTDocument).not.toHaveBeenCalled();
  });
});
