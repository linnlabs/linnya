import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import {
  projectKnowledgeSearchCompactStep,
  projectKnowledgeSearchPresentation,
} from './projectKnowledgeSearchPresentation';

function input(
  overrides: Partial<ToolPresentationProjectorInput> = {}
): ToolPresentationProjectorInput {
  return {
    sourceToolName: 'knowledge_search',
    uiKey: 'knowledge_search',
    args: { query: 'alpha', deep_search: false },
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  };
}

function currentResult(strategy: 'shallow' | 'deep') {
  return {
    data: {
      query: 'alpha',
      search_strategy: strategy,
      search_mode: 'global' as const,
      doc_name: null,
      citations: {
        query: 'alpha',
        searchMode: 'global' as const,
        citations: [
          {
            ref: '234567',
            index: 1,
            sourceType: 'knowledge_base' as const,
            docId: 'doc-1',
            blockId: 'block-1',
            docTitle: 'First.md',
            snippet: 'first',
          },
          {
            ref: '234568',
            index: 2,
            sourceType: 'knowledge_base' as const,
            docId: 'doc-1',
            blockId: 'block-2',
            docTitle: 'First.md',
            snippet: 'second',
          },
          {
            ref: '234569',
            index: 3,
            sourceType: 'knowledge_base' as const,
            docId: 'doc-1',
            blockId: 'block-3',
            docTitle: 'First.md',
            snippet: 'context',
            isContext: true,
          },
        ],
      },
    },
    observation: 'search evidence',
  };
}

describe('projectKnowledgeSearchPresentation', () => {
  it('紧凑步骤由 knowledge owner 投影查询标题', () => {
    expect(projectKnowledgeSearchCompactStep({
      sourceToolName: 'knowledge_search',
      uiKey: 'knowledge_search',
      toolCallId: 'knowledge-call-1',
      args: { query: 'subagent 功能测试', deep_search: false },
      result: undefined,
      status: 'loading',
      phase: 'start',
    })).toEqual({
      title: {
        key: 'conversation.tool.knowledgeSearch.compactQuery',
        fallback: '在知识库中搜索“{query}”',
        params: { query: 'subagent 功能测试' },
      },
    });
  });

  it('紧凑 error lifecycle 不解析非法 doc_id，也不伪造查询模式标题', () => {
    expect(projectKnowledgeSearchCompactStep({
      sourceToolName: 'knowledge_search',
      uiKey: 'knowledge_search',
      toolCallId: 'knowledge-call-error',
      args: { query: 'subagent 功能测试', doc_id: '', deep_search: false },
      result: { error: 'invalid document id' },
      status: 'error',
      phase: 'error',
    })).toEqual({
      title: {
        key: 'conversation.tool.knowledgeSearch.error',
        fallback: '搜索知识库时发生错误',
      },
    });
  });

  it('紧凑 success lifecycle 严格接纳请求与结果', () => {
    expect(() => projectKnowledgeSearchCompactStep({
      sourceToolName: 'knowledge_search',
      uiKey: 'knowledge_search',
      toolCallId: 'knowledge-call-success',
      args: { query: 'alpha', deep_search: false },
      result: { data: { query: 'alpha' } },
      status: 'success',
      phase: 'complete',
    })).toThrow();
  });

  it('loading 只校验请求，不解析 success result', () => {
    expect(projectKnowledgeSearchPresentation(input()).data).toEqual({
      kind: 'lifecycle',
      query: 'alpha',
      requestedDeepSearch: false,
      searchMode: 'global',
    });
  });

  it('未通过 owner admission 的 lifecycle 参数不会中断会话投影', () => {
    expect(
      projectKnowledgeSearchPresentation(
        input({
          args: { query: '' },
          phase: 'start',
          status: 'loading',
        })
      )
    ).toEqual({ data: { kind: 'lifecycle' } });

    expect(() =>
      projectKnowledgeSearchPresentation(
        input({
          args: { query: '' },
          result: currentResult('shallow'),
          phase: 'complete',
          status: 'success',
        })
      )
    ).toThrow();
  });

  it('当前 shallow 结果从 canonical citations 派生文件展示', () => {
    const projection = projectKnowledgeSearchPresentation(
      input({
        result: currentResult('shallow'),
        status: 'success',
        phase: 'complete',
      })
    );

    expect(projection.data).toEqual({
      kind: 'results',
      query: 'alpha',
      requestedDeepSearch: false,
      actualStrategy: 'shallow',
      searchMode: 'global',
      docName: null,
      files: [
        {
          docId: 'doc-1',
          docName: 'First.md',
          matches: [
            { id: 'doc-1:block-1', snippet: 'first' },
            { id: 'doc-1:block-2', snippet: 'second' },
          ],
        },
      ],
    });
  });

  it('请求 deep 但实际降级 shallow 时不误报 deep 结果', () => {
    const projection = projectKnowledgeSearchPresentation(
      input({
        args: { query: 'alpha', deep_search: true },
        result: currentResult('shallow'),
        status: 'success',
        phase: 'complete',
      })
    );

    expect(projection.data).toMatchObject({
      kind: 'results',
      requestedDeepSearch: true,
      actualStrategy: 'shallow',
    });
  });

  it('接纳历史 inline 结果并显式迁移 documents', () => {
    const projection = projectKnowledgeSearchPresentation(
      input({
        args: { query: 'legacy', deep_search: true },
        result: {
          data: {
            documents: [
              {
                id: 'legacy-1',
                title: 'Legacy',
                snippet: 'legacy snippet',
                doc_id: 'doc-old',
                doc_name: 'Legacy.md',
                block_id: 'block-old',
              },
            ],
            search_mode: 'global',
            doc_name: null,
            query: 'legacy',
            display_title: 'legacy search',
            citations: { query: 'legacy', searchMode: 'global', citations: [] },
          },
          observation: 'legacy evidence',
        },
        status: 'success',
        phase: 'complete',
      })
    );

    expect(projection.data).toMatchObject({
      kind: 'results',
      actualStrategy: 'deep',
      files: [{ docId: 'doc-old', docName: 'Legacy.md' }],
    });
  });

  it('接纳历史 snapshot pointer，但不在 projector 内读取快照', () => {
    const projection = projectKnowledgeSearchPresentation(
      input({
        args: { query: 'legacy', deep_search: true },
        result: {
          data: {
            count: 12,
            citation_snapshot_bundle_id: 'abcdef0123456789',
            ref_ids: [],
          },
          observation: 'snapshot pointer',
        },
        status: 'success',
        phase: 'complete',
      })
    );

    expect(projection.data).toEqual({
      kind: 'historical-snapshot-pointer',
      query: 'legacy',
      requestedDeepSearch: true,
      bundleId: 'abcdef0123456789',
      count: 12,
    });
  });

  it('浅搜索 alias 只在 success admission 拒绝 deep_search 旁路字段', () => {
    expect(
      projectKnowledgeSearchPresentation(
        input({
          sourceToolName: 'search_in_knowledgebase',
          uiKey: 'search_in_knowledgebase',
          args: { query: 'alpha', deep_search: true },
        })
      )
    ).toEqual({ data: { kind: 'lifecycle' } });

    expect(() =>
      projectKnowledgeSearchPresentation(
        input({
          sourceToolName: 'search_in_knowledgebase',
          uiKey: 'search_in_knowledgebase',
          args: { query: 'alpha', deep_search: true },
          result: currentResult('shallow'),
          status: 'success',
          phase: 'complete',
        })
      )
    ).toThrow();
  });
});
