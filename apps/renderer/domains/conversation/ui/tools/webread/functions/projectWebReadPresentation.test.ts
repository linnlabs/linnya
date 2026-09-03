import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectWebReadPresentation } from './projectWebReadPresentation';

function project(overrides: Partial<ToolPresentationProjectorInput>) {
  return projectWebReadPresentation({
    sourceToolName: 'web_read',
    uiKey: 'web_read',
    args: { url: 'https://requested.example/article' },
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  });
}

function directResult() {
  return {
    data: {
      url: 'https://canonical.example/article',
      title: 'Canonical article',
      charCount: 1234,
      truncated: false,
      provider: 'local_http',
      renderMode: 'http',
      extractor: 'readability',
      renderAttempted: false,
      escalated: false,
      citations: {
        query: 'https://requested.example/article',
        searchMode: 'web',
        citations: [{
          sourceType: 'web',
          ref: 'ABC234',
          index: 1,
          url: 'https://canonical.example/article',
          docTitle: 'Canonical article',
          snippet: 'Article excerpt',
          publishedAt: '2026-07-29',
          author: 'Example Author',
        }],
      },
      evidence_store: { bundle_id: 'bundle-web-read' },
      cacheStatus: 'miss',
    },
    observation: 'Web page evidence.',
  };
}

describe('projectWebReadPresentation', () => {
  it('生命周期阶段只接纳请求参数，不读取 success result', () => {
    expect(project({ result: { invalid: true } })).toMatchObject({
      data: { kind: 'lifecycle', target: 'https://requested.example/article' },
      title: {
        text: {
          key: 'conversation.tool.webRead.configTitleWithTarget',
          params: { target: 'https://requested.example/article' },
        },
      },
    });
  });

  it('直接 web_read 投影 canonical 页面事实', () => {
    expect(project({
      status: 'success',
      phase: 'complete',
      result: directResult(),
    })).toMatchObject({
      data: {
        kind: 'page',
        title: 'Canonical article',
        url: 'https://canonical.example/article',
        snippet: 'Article excerpt',
        author: 'Example Author',
      },
      title: {
        text: { params: { target: 'Canonical article' } },
      },
    });
  });

  it('resource_read(http/https) 显式适配 wrapper 身份', () => {
    const result = directResult();
    expect(project({
      sourceToolName: 'resource_read',
      args: { uri: 'https://requested.example/article' },
      status: 'success',
      phase: 'complete',
      result: {
        ...result,
        data: {
          uri: 'https://requested.example/article',
          source: 'web',
          ...result.data,
        },
      },
    }).data).toMatchObject({ kind: 'page', charCount: 1234 });
  });

  it('拒绝开放字段、citation 分裂和 wrapper URI 分裂', () => {
    expect(() => project({
      status: 'success',
      result: { ...directResult(), metadata: { arbitrary: true } },
    })).toThrow();

    const citationMismatch = directResult();
    citationMismatch.data.citations.citations[0].url = 'https://other.example/article';
    expect(() => project({ status: 'success', result: citationMismatch })).toThrow();

    const resourceResult = directResult();
    expect(() => project({
      sourceToolName: 'resource_read',
      args: { uri: 'https://requested.example/article' },
      status: 'success',
      result: {
        ...resourceResult,
        data: {
          uri: 'https://other.example/article',
          source: 'web',
          ...resourceResult.data,
        },
      },
    })).toThrow('Web resource result URI does not match its tool arguments.');
  });
});
