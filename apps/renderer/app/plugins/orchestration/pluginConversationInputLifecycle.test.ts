import { beforeEach, describe, expect, it } from 'vitest';
import type { PluginConversationInputContribution } from '@plugin/renderer/conversationInputContribution';
import {
  clearConversationInputAccessoriesForTest,
  readConversationInputAccessories,
  registerConversationInputAccessory,
} from '@/domains/conversation/features/input-accessories';
import {
  clearConversationReferenceKindsForTest,
  clearConversationReferenceProvidersForTest,
  readConversationReferenceProviders,
  registerConversationReferenceProvider,
  resolveConversationReferenceChipPresentation,
} from '@/domains/conversation/features/composer-references';
import {
  registerPluginConversationInputContribution,
  unregisterPluginConversationInputContribution,
} from './pluginConversationInputLifecycle';

const TestAccessory = { name: 'ConversationInputLifecycleTestAccessory', template: '<div />' };

function createConversationInputContribution(
  pluginId = 'conversation-input-test',
): PluginConversationInputContribution {
  return {
    referenceKinds: [{
      pluginId,
      kind: 'document',
      chip: {
        label: reference => reference.label,
        preview: reference => reference.previewText,
      },
    }],
    referenceProviders: [{
      pluginId,
      id: 'documents',
      query: async () => [{ id: 'doc-1', label: 'Document 1' }],
      resolveReference: candidate => ({
        pluginId,
        kind: 'document',
        label: candidate.label,
        previewText: candidate.label,
        text: candidate.label,
      }),
    }],
    accessories: [{
      pluginId,
      id: 'selection-actions',
      component: TestAccessory,
    }],
  };
}

describe('plugin conversation input lifecycle', () => {
  beforeEach(() => {
    clearConversationReferenceKindsForTest();
    clearConversationReferenceProvidersForTest();
    clearConversationInputAccessoriesForTest();
  });

  it('注册期间运行期输入贡献保持不可用，插件 active 后才开放', () => {
    let active = false;
    const contribution = createConversationInputContribution();

    registerPluginConversationInputContribution({
      pluginId: 'conversation-input-test',
      contribution,
      isPluginActive: () => active,
    });

    const [provider] = readConversationReferenceProviders();
    const [accessory] = readConversationInputAccessories();
    expect(provider?.isAvailable?.()).toBe(false);
    expect(accessory?.isVisible?.()).toBe(false);
    active = true;
    expect(provider?.isAvailable?.()).toBe(true);
    expect(accessory?.isVisible?.()).toBe(true);
    expect(resolveConversationReferenceChipPresentation({
      id: 'ref-1',
      pluginId: 'conversation-input-test',
      kind: 'document',
      label: 'Document 1',
      previewText: 'Document 1',
      text: 'Document 1',
    })).toEqual({ label: 'Document 1', preview: 'Document 1' });

    unregisterPluginConversationInputContribution(contribution);
    expect(readConversationReferenceProviders()).toEqual([]);
    expect(readConversationInputAccessories()).toEqual([]);
  });

  it('拒绝冒用其他插件身份，且不产生部分注册', () => {
    const contribution = createConversationInputContribution('other-plugin');

    expect(() => registerPluginConversationInputContribution({
      pluginId: 'conversation-input-test',
      contribution,
      isPluginActive: () => true,
    })).toThrow(/pluginId 必须与所属插件一致/);
    expect(readConversationReferenceProviders()).toEqual([]);
  });

  it('后续 provider 冲突时回滚本次先注册的 kind', () => {
    registerConversationReferenceProvider({
      pluginId: 'conversation-input-test',
      id: 'documents',
      query: async () => [],
      resolveReference: candidate => ({ text: candidate.label }),
    });
    const contribution = createConversationInputContribution();

    expect(() => registerPluginConversationInputContribution({
      pluginId: 'conversation-input-test',
      contribution,
      isPluginActive: () => true,
    })).toThrow(/provider 重复注册/);
    expect(readConversationReferenceProviders()).toHaveLength(1);
    expect(() => resolveConversationReferenceChipPresentation({
      id: 'ref-1',
      pluginId: 'conversation-input-test',
      kind: 'document',
      label: 'Document 1',
      previewText: 'Document 1',
      text: 'Document 1',
    })).toThrow(/引用类型未注册/);
  });

  it('accessory 冲突时回滚本次先注册的 kind 与 provider', () => {
    registerConversationInputAccessory({
      pluginId: 'conversation-input-test',
      id: 'selection-actions',
      component: TestAccessory,
    });

    expect(() => registerPluginConversationInputContribution({
      pluginId: 'conversation-input-test',
      contribution: createConversationInputContribution(),
      isPluginActive: () => true,
    })).toThrow(/accessory 重复注册/);

    expect(readConversationInputAccessories()).toHaveLength(1);
    expect(readConversationReferenceProviders()).toEqual([]);
    expect(() => resolveConversationReferenceChipPresentation({
      id: 'ref-1',
      pluginId: 'conversation-input-test',
      kind: 'document',
      label: 'Document 1',
      previewText: 'Document 1',
      text: 'Document 1',
    })).toThrow(/引用类型未注册/);
  });

  it('拒绝 accessory 冒用其他插件身份', () => {
    const contribution: PluginConversationInputContribution = {
      referenceKinds: [],
      referenceProviders: [],
      accessories: [{
        pluginId: 'other-plugin',
        id: 'selection-actions',
        component: TestAccessory,
      }],
    };

    expect(() => registerPluginConversationInputContribution({
      pluginId: 'conversation-input-test',
      contribution,
      isPluginActive: () => true,
    })).toThrow(/accessory selection-actions.*pluginId 必须与所属插件一致/);
    expect(readConversationInputAccessories()).toEqual([]);
  });
});
