import { describe, expect, it } from 'vitest';
import { RerankingFailure } from '../definitions/reranking';
import { validateRerankingResult } from './validateRerankingResult';

describe('validateRerankingResult', () => {
  it('接受 topN 子集并保留原文档索引身份', () => {
    expect(() => validateRerankingResult(3, [
      { originalIndex: 2, score: 0.9 },
      { originalIndex: 0, score: 0.7 },
    ])).not.toThrow();
  });

  it.each([
    [[{ originalIndex: 3, score: 0.9 }], 'invalid_document_index'],
    [[{ originalIndex: 1, score: 0.9 }, { originalIndex: 1, score: 0.8 }], 'duplicate_document_index'],
    [[{ originalIndex: 1, score: Number.NaN }], 'non_finite_score'],
  ] as const)('拒绝破坏身份或分数合同的响应：%s', (ranking, code) => {
    expect(() => validateRerankingResult(3, ranking)).toThrowError(
      expect.objectContaining<Partial<RerankingFailure>>({ code }),
    );
  });
});
