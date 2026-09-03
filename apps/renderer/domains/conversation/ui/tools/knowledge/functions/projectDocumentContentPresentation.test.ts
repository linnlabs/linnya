import { describe, expect, it } from 'vitest';
import { projectDocumentContentPresentation } from './projectDocumentContentPresentation';

const CITATION_REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function citationRefForIndex(index: number): string {
  const first = CITATION_REF_ALPHABET[index];
  const second = CITATION_REF_ALPHABET[index + 1];
  if (!first || !second) throw new Error(`测试 citation index 超出 ref alphabet: ${index}`);
  return `Ab3D${first}${second}`;
}

function createCitations(start: number, end: number) {
  return {
    query: '阅读文档: demo.md',
    searchMode: 'document' as const,
    docName: 'demo.md',
    citations: Array.from({ length: end - start + 1 }, (_, index) => ({
      ref: citationRefForIndex(start + index),
      index: start + index,
      sourceType: 'knowledge_base' as const,
      docId: 'doc-1',
      blockId: `block-${start + index}`,
      docTitle: 'demo.md',
      snippet: `chunk ${start + index}`,
    })),
  };
}

function createChunks(start: number, end: number) {
  return Array.from(
    { length: end - start + 1 },
    (_, index) => ({ index: start + index, text: `chunk ${start + index}` }),
  );
}

describe('projectDocumentContentPresentation', () => {
  it('直调工具使用实际返回范围，而不是请求范围', () => {
    const projection = projectDocumentContentPresentation({
      sourceToolName: 'knowledge_read',
      uiKey: 'knowledge_read',
      args: { doc_id: 'doc-1', start_chunk: 4, end_chunk: 20 },
      result: {
        data: {
          chunks: createChunks(4, 8),
          filename: 'demo.md',
          total_chunks: 8,
          start_chunk: 4,
          end_chunk: 8,
          mode: 'full',
          has_more: false,
          next_start_chunk: null,
          citations: createCitations(4, 8),
        },
        observation: '[Chunk 4/8]',
      },
      status: 'success',
      phase: 'complete',
    });

    expect(projection.data).toMatchObject({
      kind: 'content',
      rangeStart: 4,
      rangeEnd: 8,
    });
  });

  it('resource_read 将 0-based offset 显示成正确的 1-based chunk 范围', () => {
    const projection = projectDocumentContentPresentation({
      sourceToolName: 'resource_read',
      uiKey: 'knowledge_read',
      args: { uri: 'kb://documents/doc-1', offset: 3, limit: 5 },
      result: {
        data: {
          uri: 'kb://documents/doc-1',
          source: 'knowledge_base',
          chunks: createChunks(4, 8),
          filename: 'demo.md',
          total_chunks: 10,
          offset: 3,
          limit: 5,
          mode: 'full',
          has_more: true,
          next_offset: 8,
          citations: createCitations(4, 8),
        },
        observation: 'Cursor: to continue, set offset=8.',
      },
      status: 'success',
      phase: 'complete',
    });

    expect(projection.data).toMatchObject({
      kind: 'content',
      rangeStart: 4,
      rangeEnd: 8,
    });
  });

  it('只接纳已登记的旧 wrapper 结构，并从实际 chunks 恢复范围', () => {
    const projection = projectDocumentContentPresentation({
      sourceToolName: 'resource_read',
      uiKey: 'knowledge_read',
      args: { uri: 'kb://documents/doc-legacy', offset: 0, limit: 6 },
      result: {
        data: {
          chunks: createChunks(1, 2),
          filename: 'legacy.pdf',
          total_chunks: 22,
          mode: 'glance',
          has_more: true,
        },
        observation: '[Chunk 1/22]',
      },
      status: 'success',
      phase: 'complete',
    });

    expect(projection.data).toMatchObject({
      kind: 'content',
      rangeStart: 1,
      rangeEnd: 2,
    });
  });

  it('loading 阶段只校验请求，不解析 success result', () => {
    expect(projectDocumentContentPresentation({
      sourceToolName: 'resource_read',
      uiKey: 'knowledge_read',
      args: { uri: 'kb://documents/doc-1' },
      result: undefined,
      status: 'loading',
      phase: 'start',
    }).data).toEqual({
      kind: 'lifecycle',
      documentIdentity: 'kb://documents/doc-1',
    });
  });
});
