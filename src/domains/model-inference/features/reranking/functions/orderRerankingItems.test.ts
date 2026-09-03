import { describe, expect, it } from 'vitest';
import { orderRerankingItems } from './orderRerankingItems';

describe('orderRerankingItems', () => {
  it('按分数降序，并以原文档顺序稳定处理同分', () => {
    expect(orderRerankingItems([
      { originalIndex: 2, score: 0.8 },
      { originalIndex: 1, score: 0.9 },
      { originalIndex: 0, score: 0.8 },
    ])).toEqual([
      { originalIndex: 1, score: 0.9 },
      { originalIndex: 0, score: 0.8 },
      { originalIndex: 2, score: 0.8 },
    ]);
  });
});
