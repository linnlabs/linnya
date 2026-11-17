import { describe, expect, it } from 'vitest';
import type { RetrievedPoint } from '../infrastructure/qdrantRepository';
import { applyIntelligentLayeredSorting, rrfFusion, type LayeredRankingResult } from './ranking';

function point(id: string, document: string, score: number): RetrievedPoint {
  return {
    id,
    score,
    payload: {
      doc_id: `doc-${id}`,
      block_id: `block-${id}`,
      document,
      doc_title: `title-${id}`,
      block_type: 'paragraph',
    },
  };
}

describe('Knowledge Base ranking', () => {
  it('RRF 融合保留 payload 身份并区分 hybrid/keyword 来源', () => {
    const semantic = point('shared', 'shared text', 0.8);
    const keywordOnly = point('keyword', 'keyword text', 0.7);

    const result = rrfFusion(
      [semantic],
      [{ ...semantic, score: 0.9 }, keywordOnly],
      60,
    );

    expect(result).toMatchObject([
      { id: 'shared', match_type: 'hybrid', keyword_score: 0.9 },
      { id: 'keyword', match_type: 'keyword', keyword_score: 0.7 },
    ]);
    expect(result[0].payload).toBe(semantic.payload);
  });

  it('精确匹配优先于高 rerank 分数，零分不会被 RRF 分数替代', () => {
    const results: LayeredRankingResult[] = [
      {
        ...point('semantic', 'unrelated content', 0.95),
        match_type: 'semantic',
        rerank_score: 0,
      },
      {
        ...point('exact', 'target', 0.1),
        match_type: 'semantic',
        rerank_score: 0.1,
      },
    ];

    const sorted = applyIntelligentLayeredSorting(results, 'target');

    expect(sorted.map(item => item.id)).toEqual(['exact', 'semantic']);
    expect(sorted[0].final_match_type).toBe('exact');
  });
});
