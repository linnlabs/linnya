import { describe, expect, it } from 'vitest';
import { type RerankingPort } from '@plugin/backend/inferenceRuntime';
import { RerankingFailure } from '@plugin/backend/inferenceFailures';

import { DefaultSearchRanker } from './defaultSearchRanker';
import { KnowledgeSearchRerankError } from './knowledgeSearchRerankError';
import type { RankedRetrievedPoint } from './types';

function point(id: string, document: string, score: number): RankedRetrievedPoint {
  return {
    id,
    score,
    match_type: 'semantic',
    payload: {
      doc_id: `doc-${id}`,
      block_id: `block-${id}`,
      document,
      doc_title: `title-${id}`,
      block_type: 'paragraph',
    },
  };
}

describe('DefaultSearchRanker reranking', () => {
  it('按 originalIndex 映射重复文本，不通过文本反查身份', async () => {
    const searchResults = [point('first', 'same text', 0.8), point('second', 'same text', 0.7)];
    const reranking: RerankingPort = {
      rerank: async request => {
        expect(request.documents).toEqual(['same text', 'same text']);
        return {
          ranking: [
            { originalIndex: 1, score: 0.95 },
            { originalIndex: 0, score: 0.6 },
          ],
        };
      },
    };

    await expect(
      new DefaultSearchRanker().rerankResults(
        reranking,
        'reranking-model',
        'query',
        searchResults,
        2
      )
    ).resolves.toMatchObject([
      { id: 'second', rerankScore: 0.95 },
      { id: 'first', rerankScore: 0.6 },
    ]);
  });

  it('仅对 retryable Provider 可用性故障保留已有排序', async () => {
    const searchResults = [point('first', 'first text', 0.8)];
    const reranking: RerankingPort = {
      rerank: async () => {
        throw new RerankingFailure('provider', 'provider_http_503', true, 'unavailable');
      },
    };

    await expect(
      new DefaultSearchRanker().rerankResults(reranking, 'reranking-model', 'query', searchResults)
    ).resolves.toBe(searchResults);
  });

  it('不吞掉路由和凭据等不可重试配置错误：带原因上抛，Agent 说明只用英文与失败码', async () => {
    const failure = new RerankingFailure('protocol', 'credential_missing', false, '缺少凭据的 Host 诊断');
    const reranking: RerankingPort = {
      rerank: async () => {
        throw failure;
      },
    };

    const error = await new DefaultSearchRanker()
      .rerankResults(reranking, 'reranking-model', 'query', [point('first', 'first text', 0.8)])
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KnowledgeSearchRerankError);
    expect(error).toMatchObject({ cause: failure });
    expect(error).toHaveProperty(
      'toolMessage',
      expect.stringMatching(/reranking model did not succeed \(credential_missing\)\. Retrying will not help/u)
    );
    expect(error).not.toHaveProperty('toolMessage', expect.stringMatching(/[一-鿿]/u));
  });
});
