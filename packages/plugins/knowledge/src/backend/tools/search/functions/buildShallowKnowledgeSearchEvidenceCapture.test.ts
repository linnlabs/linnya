import { describe, expect, it } from 'vitest';
import type { KnowledgeSearchResult } from '@app/schemas';
import { buildShallowKnowledgeSearchEvidenceCapture } from './buildShallowKnowledgeSearchEvidenceCapture';

function createResult(): KnowledgeSearchResult {
  return {
    data: {
      query: '统一数据模型',
      search_strategy: 'shallow',
      search_mode: 'global',
      doc_name: null,
      citations: {
        query: '统一数据模型',
        searchMode: 'global',
        citations: [
          {
            ref: 'Abc234',
            index: 1,
            sourceType: 'knowledge_base',
            docId: 'document-1',
            blockId: 'block-1',
            docTitle: '产品模型.md',
            snippet: 'Linnya 是一个以 Agent 为中心的文档数据库。',
          },
        ],
      },
    },
    observation: [
      "Result 1 [@Abc234]: Document '产品模型.md'",
      '  ├─ Hit:  "Linnya 是一个以 Agent 为中心的文档数据库。"',
      "  (Ref: doc_id='document-1', block_id='block-1', 匹配类型: 语义匹配)",
    ].join('\n'),
  };
}

describe('buildShallowKnowledgeSearchEvidenceCapture', () => {
  it('捕获 AI 实际看见的 canonical search snippet', () => {
    const result = buildShallowKnowledgeSearchEvidenceCapture({
      result: createResult(),
      capturedAtMs: 100,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        ref: 'Abc234',
        documentId: 'document-1',
        blockId: 'block-1',
        contentText: 'Linnya 是一个以 Agent 为中心的文档数据库。',
        captureKind: 'knowledge_search_result',
        capturedAtMs: 100,
      }),
    ]);
  });

  it('空搜索不产生 Evidence items', () => {
    const result = createResult();
    result.data.citations.citations = [];
    result.observation = 'No relevant results found.';

    expect(buildShallowKnowledgeSearchEvidenceCapture({ result, capturedAtMs: 100 }).items).toEqual(
      []
    );
  });

  it('ref 未进入 AI observation 时明确失败', () => {
    const result = createResult();
    result.observation = result.observation.replace('[@Abc234]', 'missing-ref');

    expect(() => buildShallowKnowledgeSearchEvidenceCapture({ result, capturedAtMs: 100 })).toThrow(
      'canonical ref 未出现在 AI observation'
    );
  });
});
