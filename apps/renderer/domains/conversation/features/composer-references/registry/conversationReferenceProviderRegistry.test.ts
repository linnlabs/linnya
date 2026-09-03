import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationReferenceProviderContribution } from '@linnya/plugin-host-contract/renderer';
import {
  clearConversationReferenceProvidersForTest,
  readConversationReferenceProviders,
  registerConversationReferenceProvider,
} from './conversationReferenceProviderRegistry';

function createProvider(
  pluginId: string,
  id: string,
): ConversationReferenceProviderContribution {
  return {
    pluginId,
    id,
    query: vi.fn().mockResolvedValue([]),
    resolveReference: candidate => ({ text: candidate.label }),
  };
}

describe('conversationReferenceProviderRegistry', () => {
  beforeEach(() => {
    clearConversationReferenceProvidersForTest();
  });

  it('按注册顺序读取所有候选源贡献', () => {
    const workspaceProvider = createProvider('platform', 'workspace-document');
    const knowledgeProvider = createProvider('knowledgebase', 'document');

    registerConversationReferenceProvider(workspaceProvider);
    registerConversationReferenceProvider(knowledgeProvider);

    expect(readConversationReferenceProviders()).toEqual([
      workspaceProvider,
      knowledgeProvider,
    ]);
  });

  it('把空身份与同一 pluginId + id 的重复注册视为契约错误', () => {
    const provider = createProvider('platform', 'workspace-document');
    registerConversationReferenceProvider(provider);

    expect(() => registerConversationReferenceProvider(provider))
      .toThrow('provider 重复注册: platform:workspace-document');
    expect(() => registerConversationReferenceProvider(createProvider('  ', 'document')))
      .toThrow('provider pluginId 不能为空');
    expect(() => registerConversationReferenceProvider(createProvider('platform', '  ')))
      .toThrow('provider id 不能为空');
  });
});
