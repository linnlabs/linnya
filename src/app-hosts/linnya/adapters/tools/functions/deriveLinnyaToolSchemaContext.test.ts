import { describe, expect, it } from 'vitest';
import { deriveLinnyaToolSchemaContext } from './deriveLinnyaToolSchemaContext';

describe('deriveLinnyaToolSchemaContext', () => {
  it('只暴露 concrete tool 构建动态 Schema 所需的 Linnya 字段', () => {
    const productInvocation = {
      query: 'generate an image',
      promptKey: 'default',
      imageGenerationModelId: '  configured-image-model  ',
      callerAgentId: 'frozen-agent',
      availableSubagentTypes: ['scoped_reviewer'],
      metadata: { callerAgentId: 'forged-agent', availableSubagentTypes: ['general'] },
    };

    expect(deriveLinnyaToolSchemaContext(productInvocation)).toEqual({
      imageGenerationModelId: 'configured-image-model',
      callerAgentId: 'frozen-agent',
      availableSubagentTypes: ['scoped_reviewer'],
    });
  });

  it('保留空白名单的禁用语义，无效范围不能降级成无限制', () => {
    const invocation = { query: 'Delegate', promptKey: 'default', availableSubagentTypes: [] };
    expect(deriveLinnyaToolSchemaContext(invocation).availableSubagentTypes).toEqual([]);
    const invalid = { ...invocation, availableSubagentTypes: 'general' };
    expect(() => deriveLinnyaToolSchemaContext(invalid)).toThrow();
  });
});
