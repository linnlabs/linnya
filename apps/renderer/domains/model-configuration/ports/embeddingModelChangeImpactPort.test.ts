import { describe, expect, it } from 'vitest';
import { peekEmbeddingModelChangeImpactPort, registerEmbeddingModelChangeImpactPort } from './embeddingModelChangeImpactPort';

describe('embedding impact provider lifecycle', () => {
  it('停用撤销查询，旧实例收尾不撤销已替换的新实例', () => {
    const first = { findImpactedKnowledgeBases: async () => [], findKnowledgeBasesUsingModel: async () => [] };
    const second = { ...first };
    const stopFirst = registerEmbeddingModelChangeImpactPort(first);
    const stopSecond = registerEmbeddingModelChangeImpactPort(second);
    stopFirst();
    expect(peekEmbeddingModelChangeImpactPort()).toBe(second);
    stopSecond();
    expect(peekEmbeddingModelChangeImpactPort()).toBeNull();
  });
});
