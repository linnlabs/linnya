import { describe, expect, it, vi } from 'vitest';
import { resolveKnowledgeGraphExtractionModelId } from '../index';

describe('resolveKnowledgeGraphExtractionModelId', () => {
  it('没有功能默认模型时不抽取，也不改用其他模型', () => {
    const getModel = vi.fn(() => ({ id: 'user-chat-model' }));

    expect(resolveKnowledgeGraphExtractionModelId({ modelCatalog: { getModel } })).toBeNull();
    expect(getModel).not.toHaveBeenCalled();
  });
});
