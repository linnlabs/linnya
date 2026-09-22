import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import {
  projectWebSearchCompactStep,
  projectWebSearchPresentation,
} from './projectWebSearchPresentation';

function project(overrides: Partial<ToolPresentationProjectorInput>) {
  return projectWebSearchPresentation({
    sourceToolName: 'web_search',
    uiKey: 'web_search',
    args: { query: 'Linnya' },
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  });
}

function successResult() {
  return {
    data: {
      query: 'Linnya',
      resultCount: 2,
      citations: {
        query: 'Linnya',
        searchMode: 'web',
        citations: [
          {
            sourceType: 'web',
            ref: 'ABC234',
            index: 4,
            url: 'https://example.com/first',
            docTitle: 'First result',
            snippet: 'First snippet',
            siteName: 'Example',
          },
          {
            sourceType: 'web',
            ref: 'DEF567',
            index: 5,
            url: 'https://example.com/second',
            docTitle: 'Second result',
            snippet: 'Second snippet',
            publishedAt: '2026-07-29',
          },
        ],
      },
      evidence_store: { bundle_id: 'bundle-web-search' },
      cacheStatus: 'miss',
    },
    observation: 'Search results for Linnya.',
  };
}

describe('projectWebSearchPresentation', () => {
  it('紧凑步骤由 web owner 投影查询标题', () => {
    expect(
      projectWebSearchCompactStep({
        sourceToolName: 'web_search',
        uiKey: 'web_search',
        toolCallId: 'web-call-1',
        args: { query: 'subagent 功能测试' },
        result: undefined,
        status: 'loading',
        phase: 'start',
      })
    ).toEqual({
      title: {
        key: 'conversation.tool.webSearch.compactQuery',
        fallback: '联网搜索“{query}”',
        params: { query: 'subagent 功能测试' },
      },
    });
  });

  it('紧凑 error lifecycle 使用 owner 失败标题且不解析成功参数', () => {
    expect(
      projectWebSearchCompactStep({
        sourceToolName: 'web_search',
        uiKey: 'web_search',
        toolCallId: 'web-call-error',
        args: { query: '' },
        result: { error: 'query rejected' },
        status: 'error',
        phase: 'error',
      })
    ).toEqual({
      title: {
        key: 'conversation.tool.webSearch.failed',
        fallback: '搜索失败',
      },
    });
  });

  it('紧凑 success 不读取完整结果，只根据请求生成短标题', () => {
    expect(
      projectWebSearchCompactStep({
        sourceToolName: 'web_search',
        uiKey: 'web_search',
        toolCallId: 'web-call-success',
        args: { query: 'Linnya' },
        result: { data: { query: 'Linnya' } },
        status: 'success',
        phase: 'complete',
      })
    ).toEqual({
      title: {
        key: 'conversation.tool.webSearch.compactQuery',
        fallback: '联网搜索“{query}”',
        params: { query: 'Linnya' },
      },
    });
  });

  it('生命周期阶段只接纳参数，不读取 success result', () => {
    expect(project({ result: { invalid: true } })).toMatchObject({
      data: { kind: 'lifecycle' },
      title: {
        text: {
          key: 'conversation.tool.webSearch.configTitleWithQuery',
          params: { query: 'Linnya' },
        },
      },
    });
  });

  it('深搜部分资料包实时与重载保持相同模式、限制和子轨迹身份；第五次显示实际浅搜', () => {
    const result = {
      data: {
        query: 'Linnya',
        search_strategy: 'deep',
        resultCount: 0,
        subrun_ids: ['child-1'],
        citations: { query: 'Linnya', searchMode: 'web', citations: [] },
        evidence_store: { bundle_id: 'bundle' },
        research: {
          source_notes: [],
          summary: '',
          gaps: ['Sources blocked'],
          conflicts: [],
          failures: [{ tool: 'web_read', call_id: 'read-1', error: 'HTTP 403' }],
          search_count: 1,
          read_attempt_count: 1,
        },
      },
      observation: 'No readable sources',
    };
    const live = project({
      args: { query: 'Linnya', deep_search: true },
      status: 'success',
      result,
    });
    expect(live).toEqual(
      project({
        args: { query: 'Linnya', deep_search: true },
        status: 'success',
        result: JSON.parse(JSON.stringify(result)),
      })
    );
    expect(live.data).toMatchObject({
      strategy: 'deep',
      subrunIds: ['child-1'],
      materials: { gaps: ['Sources blocked'] },
    });
    expect(
      project({ args: { query: 'Linnya', deep_search: true }, status: 'error', result: undefined })
        .data
    ).toMatchObject({ kind: 'lifecycle', requestedDeepSearch: true });
    const shallow = successResult();
    const fallback = {
      ...shallow,
      data: { ...shallow.data, search_strategy: 'shallow', downgrade_reason: 'deep_search_limit' },
    };
    expect(
      project({ args: { query: 'Linnya', deep_search: true }, status: 'success', result: fallback })
        .data
    ).toMatchObject({ strategy: 'shallow', limited: true });
  });

  it('将正式 web citations 投影为稳定展示列表', () => {
    expect(
      project({
        status: 'success',
        phase: 'complete',
        result: successResult(),
      })
    ).toMatchObject({
      data: {
        kind: 'results',
        query: 'Linnya',
        items: [
          { id: 'ABC234', url: 'https://example.com/first', docTitle: 'First result' },
          { id: 'DEF567', url: 'https://example.com/second', publishedAt: '2026-07-29' },
        ],
      },
    });
  });

  it('拒绝数量、索引或身份不一致的成功结果', () => {
    const invalid = successResult();
    invalid.data.resultCount = 1;
    invalid.data.citations.citations[1].index = 7;
    invalid.data.citations.citations[1].ref = 'ABC234';
    invalid.data.citations.citations[1].url = 'https://example.com/first';
    expect(() => project({ status: 'success', result: invalid })).toThrow();
  });

  it('拒绝参数与结果 query 分裂以及开放扩展字段', () => {
    const mismatched = successResult();
    mismatched.data.query = 'Other query';
    mismatched.data.citations.query = 'Other query';
    expect(() => project({ status: 'success', result: mismatched })).toThrow(
      'Web search result query does not match its tool arguments.'
    );

    expect(() =>
      project({
        status: 'success',
        result: {
          ...successResult(),
          metadata: { arbitrary: true },
        },
      })
    ).toThrow();
  });
});
