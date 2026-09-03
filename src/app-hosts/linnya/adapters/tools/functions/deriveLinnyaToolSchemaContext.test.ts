import { describe, expect, it } from 'vitest';
import { deriveLinnyaToolSchemaContext } from './deriveLinnyaToolSchemaContext';

describe('deriveLinnyaToolSchemaContext', () => {
  it('只暴露 concrete tool 构建动态 Schema 所需的 Linnya 字段', () => {
    const productInvocation = {
      query: 'generate an image',
      promptKey: 'default',
      imageGenerationModelId: '  configured-image-model  ',
    };

    expect(deriveLinnyaToolSchemaContext(productInvocation)).toEqual({
      imageGenerationModelId: 'configured-image-model',
    });
  });
});
