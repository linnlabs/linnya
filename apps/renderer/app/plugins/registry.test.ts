import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { computed } from 'vue';
import { ConversationAgentIds, ConversationSelectedAgentIdSchema } from '@app/schemas';
import {
  activateRendererPlugin,
  clearRendererPluginRegistryForTest,
  deactivateRendererPlugin,
  getDocumentActionMenuByActiveType,
  getDocumentTypeByNodeType,
  getConversationAgentChoiceById,
  getDocumentRuntimeLoaderByActiveType,
  hasRendererPlugin,
  listCreatableDocumentTypesForLoadedRuntimeState,
  listEnabledCreatableDocumentTypes,
  listConversationAgentChoices,
  listActiveRendererPluginIds,
  listToolCards,
  registerRendererPlugin,
  requireActiveConversationSubrunWorker,
  resolveDocumentTypeByActiveType,
  resolveDocumentTypeByNodeType,
} from './registry';
import {
  clearConversationReferenceKindsForTest,
  clearConversationReferenceProvidersForTest,
  readConversationReferenceProviders,
  registerConversationReferenceProvider,
  resolveConversationReferenceChipPresentation,
  useComposerReferences,
} from '@/domains/conversation/features/composer-references';
import {
  clearConversationInputAccessoriesForTest,
  readConversationInputAccessories,
  resolveVisibleConversationInputAccessories,
} from '@/domains/conversation/features/input-accessories';
import { buildDocumentTypeUnavailableMessage } from './functions/documentTypeUnavailablePresentation';
import type { DocumentTypeUnavailableMessageResolver } from './functions/documentTypeUnavailablePresentation';

const TestSurface = { name: 'RegistryTestSurface', template: '<div />' };
const OPTIONAL_AGENT_ID = ConversationSelectedAgentIdSchema.parse('registry_optional_agent');
const unavailableMessage: DocumentTypeUnavailableMessageResolver = {
  disabled: ({ pluginName }) => `当前插件已停用：${pluginName}`,
  missing: ({ pluginName }) => `安装后可打开：${pluginName}`,
  loadFailed: ({ pluginName }) => `前端入口加载失败：${pluginName}`,
  unknown: ({ nodeType }) => `未知文档类型：${nodeType}`,
  fallback: () => '文档类型不可用',
};

describe('renderer plugin registry enabled filtering', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    clearRendererPluginRegistryForTest();
    clearConversationReferenceKindsForTest();
    clearConversationReferenceProvidersForTest();
    clearConversationInputAccessoriesForTest();
  });

  it('按 enabled 集合收缩可选插件的文档类型和工具卡贡献', () => {
    registerRendererPlugin({
      meta: {
        id: 'registry-test-platform',
        name: 'Registry Test Platform',
        version: '1.0.0',
        description: 'Renderer registry test platform plugin',
        developer: 'Linnya',
        builtin: true,
        required: true,
      },
      documentTypes: [{
        pluginId: 'registry-test-platform',
        nodeType: 'registry-test-document',
        activeDocumentType: 'registry-test-editor',
        fileSessionType: 'registry-test-markdown',
        createRequestType: 'registry-test-document',
        createBackend: 'workspace-document',
        surfaceComponent: TestSurface,
        label: '测试文档',
        createLabel: '新建测试文档',
        defaultName: '未命名测试文档',
        iconComponent: TestSurface,
        iconClass: 'file-icon',
        createPriority: 10,
        entityReferences: [{
          kind: 'document',
          uriPattern: 'linnya://registry-test/document/{documentId}',
          description: '测试文档根实体。',
        }],
      }],
      toolCards: {
        registry_test_platform_tool: {
          component: TestSurface,
        },
      },
    });

    registerRendererPlugin({
      meta: {
        id: 'registry-test-canvas',
        name: 'Registry Test Canvas',
        version: '1.0.0',
        description: 'Renderer registry test canvas plugin',
        developer: 'Linnya',
        builtin: true,
        required: false,
        dependsOn: ['registry-test-platform'],
      },
      documentTypes: [{
        pluginId: 'registry-test-canvas',
        nodeType: 'registry-test-canvas',
        activeDocumentType: 'registry-test-canvas',
        fileSessionType: 'registry-test-canvas',
        createRequestType: 'registry-test-canvas',
        createBackend: 'plugin-document',
        createHandlerId: 'registry-test-canvas.create',
        surfaceComponent: TestSurface,
        label: '测试思维导图',
        createLabel: '新建测试思维导图',
        defaultName: '未命名测试思维导图',
        iconComponent: TestSurface,
        iconClass: 'canvas-icon',
        createPriority: 20,
        entityReferences: [{
          kind: 'document',
          uriPattern: 'linnya://registry-test/canvas/{documentId}',
          description: '测试画布根实体。',
        }],
      }],
      toolCards: {
        registry_test_canvas_tool: {
          component: TestSurface,
          compactStep: () => ({
            title: {
              key: 'registry.test.canvas.compact',
              fallback: '执行测试思维导图工具',
            },
          }),
        },
      },
      documentActionMenus: [{
        activeDocumentType: 'registry-test-canvas',
        tooltip: '测试菜单',
        ariaLabel: '测试文档菜单',
        isAvailable: () => true,
        getOptions: () => [{ value: 'test-action', text: '测试动作' }],
        select: () => undefined,
      }],
      documentRuntimeLoaders: [{
        activeDocumentType: 'registry-test-canvas',
        load: () => undefined,
      }],
    });

    const enabledPlatformOnly = new Set(['registry-test-platform']);
    expect(listEnabledCreatableDocumentTypes(enabledPlatformOnly).map((type) => type.createRequestType))
      .toContain('registry-test-document');
    expect(listEnabledCreatableDocumentTypes(enabledPlatformOnly).map((type) => type.createRequestType))
      .not.toContain('registry-test-canvas');
    expect(resolveDocumentTypeByActiveType('registry-test-canvas', enabledPlatformOnly).state)
      .toBe('disabled');
    const disabledNodeType = resolveDocumentTypeByNodeType('registry-test-canvas', enabledPlatformOnly, [
      {
        meta: {
          id: 'registry-test-platform',
          name: 'Registry Test Platform',
          version: '1.0.0',
          description: 'Renderer registry test platform plugin',
          developer: 'Linnya',
          builtin: true,
          required: true,
        },
        state: 'enabled',
      },
      {
        meta: {
          id: 'registry-test-canvas',
          name: 'Registry Test Canvas',
          version: '1.0.0',
          description: 'Renderer registry test canvas plugin',
          developer: 'Linnya',
          builtin: true,
          required: false,
          ownedFileTypes: [{
            nodeType: 'registry-test-canvas',
            extension: '.canvas',
            label: '测试思维导图',
          }],
        },
        state: 'disabled',
      },
    ]);
    expect(disabledNodeType.state).toBe('disabled');
    if (disabledNodeType.state !== 'disabled') {
      throw new Error('expected disabled document type');
    }
    expect(disabledNodeType.documentType).toBe(getDocumentTypeByNodeType('registry-test-canvas'));
    expect(buildDocumentTypeUnavailableMessage(disabledNodeType, unavailableMessage)).toContain('当前插件已停用');
    expect(Object.keys(listToolCards(enabledPlatformOnly))).toContain('registry_test_platform_tool');
    expect(Object.keys(listToolCards(enabledPlatformOnly))).not.toContain('registry_test_canvas_tool');
    expect(listToolCards(enabledPlatformOnly)['registry_test_canvas_tool']).toBeUndefined();
    expect(getDocumentActionMenuByActiveType('registry-test-canvas', enabledPlatformOnly)).toBeNull();
    expect(getDocumentRuntimeLoaderByActiveType('registry-test-canvas', enabledPlatformOnly)).toBeNull();

    const enabledBoth = new Set(['registry-test-platform', 'registry-test-canvas']);
    expect(listEnabledCreatableDocumentTypes(enabledBoth).map((type) => type.createRequestType))
      .toContain('registry-test-canvas');
    expect(resolveDocumentTypeByActiveType('registry-test-canvas', enabledBoth).state)
      .toBe('enabled');
    expect(resolveDocumentTypeByNodeType('registry-test-canvas', enabledBoth).state)
      .toBe('enabled');
    expect(getDocumentActionMenuByActiveType('registry-test-canvas', enabledBoth)?.getOptions()).toEqual([
      { value: 'test-action', text: '测试动作' },
    ]);
    expect(getDocumentRuntimeLoaderByActiveType('registry-test-canvas', enabledBoth)).not.toBeNull();
    expect(Object.keys(listToolCards(enabledBoth))).toContain('registry_test_canvas_tool');
    const enabledCanvasTool = listToolCards(enabledBoth)['registry_test_canvas_tool'];
    expect(enabledCanvasTool && 'compactStep' in enabledCanvasTool)
      .toBe(true);
  });

  it('filters conversation agent choice contributions by enabled plugin ids', () => {
    registerRendererPlugin({
      meta: {
        id: 'registry-test-platform',
        name: 'Registry Test Platform',
        version: '1.0.0',
        description: 'Renderer registry test platform plugin',
        developer: 'Linnya',
        builtin: true,
        required: true,
      },
      conversationAgentChoices: [{
        id: 'registry-test-research',
        agentId: ConversationAgentIds.DEEP_RESEARCH,
        menuText: '测试研究',
        pillText: '研究',
        ariaLabel: '已开启：测试研究',
        iconComponent: TestSurface,
      }],
    });
    registerRendererPlugin({
      meta: {
        id: 'registry-test-optional-agent',
        name: 'Registry Test Optional Agent',
        version: '1.0.0',
        description: 'Renderer registry optional agent fixture',
        developer: 'Linnya',
        builtin: true,
        required: false,
      },
      conversationAgentChoices: [{
        id: 'registry-test-optional',
        agentId: OPTIONAL_AGENT_ID,
        menuText: '测试可选 Agent',
        pillText: '可选',
        ariaLabel: '已开启：测试可选 Agent',
        iconComponent: TestSurface,
      }],
    });

    const enabledPlatformOnly = new Set(['registry-test-platform']);
    expect(listConversationAgentChoices(enabledPlatformOnly).map((choice) => choice.id))
      .toEqual(['registry-test-research']);
    expect(getConversationAgentChoiceById('registry-test-optional', enabledPlatformOnly)).toBeNull();

    const enabledBoth = new Set(['registry-test-platform', 'registry-test-optional-agent']);
    expect(listConversationAgentChoices(enabledBoth).map((choice) => choice.id))
      .toEqual(['registry-test-research', 'registry-test-optional']);
    expect(getConversationAgentChoiceById('registry-test-optional', enabledBoth)?.menuText).toBe('测试可选 Agent');
  });

  it('requires explicit enabled plugin ids for runtime agent choice listings', () => {
    registerRendererPlugin({
      meta: {
        id: 'registry-test-optional-agent',
        name: 'Registry Test Optional Agent',
        version: '1.0.0',
        description: 'Renderer registry optional agent fixture',
        developer: 'Linnya',
        builtin: true,
        required: false,
      },
      conversationAgentChoices: [{
        id: 'registry-test-optional',
        agentId: OPTIONAL_AGENT_ID,
        menuText: '测试可选 Agent',
        pillText: '可选',
        ariaLabel: '已开启：测试可选 Agent',
        iconComponent: TestSurface,
      }],
    });

    expect(listConversationAgentChoices(new Set()).map((choice) => choice.id)).toEqual([]);
    expect(getConversationAgentChoiceById('registry-test-optional', new Set())).toBeNull();
  });

  it('在 registry admission 拒绝空的 AgentDefinition.id', () => {
    const invalidAgentChoice = {
      id: 'invalid-agent-choice',
      agentId: OPTIONAL_AGENT_ID,
      menuText: '无效 Agent',
      pillText: '无效',
      ariaLabel: '无效 Agent',
      iconComponent: TestSurface,
    };
    Reflect.set(invalidAgentChoice, 'agentId', '');

    expect(() => registerRendererPlugin({
      meta: {
        id: 'registry-test-invalid-agent-choice',
        name: 'Invalid Agent Choice',
        version: '1.0.0',
        description: 'Invalid agent choice fixture',
        developer: 'Linnya',
        builtin: true,
        required: false,
      },
      conversationAgentChoices: [invalidAgentChoice],
    })).toThrow();
  });

  it('只解析 active 插件显式声明的 subrun worker', async () => {
    const pluginId = 'registry-test-subrun-worker';
    registerRendererPlugin({
      meta: {
        id: pluginId,
        name: 'Subrun Worker Test',
        version: '1.0.0',
        description: 'Subrun worker registry test',
        developer: 'Linnya',
        builtin: false,
      },
      subrunWorkers: [{ id: 'research', promptKey: 'plugin_research_worker' }],
    });

    expect(() => requireActiveConversationSubrunWorker(pluginId, 'research'))
      .toThrow(/插件未激活/);
    await activateRendererPlugin(pluginId);
    expect(requireActiveConversationSubrunWorker(pluginId, 'research'))
      .toEqual({ promptKey: 'plugin_research_worker' });
    expect(() => requireActiveConversationSubrunWorker(pluginId, 'missing'))
      .toThrow(/worker 未声明/);
  });

  it('拒绝同一插件重复声明 subrun worker id', () => {
    expect(() => registerRendererPlugin({
      meta: {
        id: 'registry-test-duplicate-subrun-worker',
        name: 'Duplicate Subrun Worker Test',
        version: '1.0.0',
        description: 'Duplicate subrun worker test',
        developer: 'Linnya',
        builtin: false,
      },
      subrunWorkers: [
        { id: 'research', promptKey: 'worker_a' },
        { id: 'research', promptKey: 'worker_b' },
      ],
    })).toThrow(/worker 重复声明/);
  });

  it('拒绝带首尾空白的 subrun worker 身份，避免注册与解析使用不同 key', () => {
    expect(() => registerRendererPlugin({
      meta: {
        id: 'registry-test-worker-whitespace',
        name: 'Registry Test Worker Whitespace',
        version: '1.0.0',
        description: 'Renderer registry worker whitespace test plugin',
        developer: 'Linnya',
        builtin: false,
      },
      subrunWorkers: [{ id: 'research ', promptKey: 'plugin_research_worker' }],
    })).toThrow(/首尾空白/);
  });

  it('does not expose creatable document types before runtime plugin state is loaded', () => {
    registerRendererPlugin({
      meta: {
        id: 'registry-test-platform',
        name: 'Registry Test Platform',
        version: '1.0.0',
        description: 'Renderer registry test platform plugin',
        developer: 'Linnya',
        builtin: true,
        required: true,
      },
      documentTypes: [{
        pluginId: 'registry-test-platform',
        nodeType: 'registry-test-document',
        activeDocumentType: 'registry-test-editor',
        fileSessionType: 'registry-test-markdown',
        createRequestType: 'registry-test-document',
        createBackend: 'workspace-document',
        surfaceComponent: TestSurface,
        label: '测试文档',
        createLabel: '新建测试文档',
        defaultName: '未命名测试文档',
        iconComponent: TestSurface,
        iconClass: 'file-icon',
        createPriority: 10,
        entityReferences: [{
          kind: 'document',
          uriPattern: 'linnya://registry-test/document/{documentId}',
          description: '测试文档根实体。',
        }],
      }],
    });

    const enabledPluginIds = new Set(['registry-test-platform']);

    expect(listCreatableDocumentTypesForLoadedRuntimeState({
      hasLoaded: false,
      enabledPluginIds,
    })).toEqual([]);
    expect(listCreatableDocumentTypesForLoadedRuntimeState({
      hasLoaded: true,
      enabledPluginIds,
    }).map((type) => type.createRequestType)).toEqual(['registry-test-document']);
  });

  it('未注册 renderer 贡献时按 ownedFileTypes 解析插件归属', () => {
    const missing = resolveDocumentTypeByNodeType('registry-test-unloaded-map', new Set(['registry-test-platform']), [
      {
        meta: {
          id: 'registry-test-unloaded-plugin',
          name: 'Unloaded Canvas Plugin',
          version: '1.0.0',
          description: 'Renderer registry test unloaded plugin',
          developer: 'Linnya',
          builtin: true,
          required: false,
          ownedFileTypes: [{
            nodeType: 'registry-test-unloaded-map',
            extension: '.map',
            label: '未加载导图',
          }],
        },
        state: 'missing',
      },
    ]);

    expect(missing).toMatchObject({
      state: 'missing',
      pluginId: 'registry-test-unloaded-plugin',
      pluginName: 'Unloaded Canvas Plugin',
      label: '未加载导图',
      extension: '.map',
    });
    expect(buildDocumentTypeUnavailableMessage(missing, unavailableMessage)).toContain('安装后可打开');
  });

  it('已启用插件声明 ownedFileTypes 但 renderer contribution 未注册时暴露加载失败状态', () => {
    const availability = resolveDocumentTypeByNodeType('registry-test-unloaded-enabled-map', new Set([
      'registry-test-unloaded-enabled-plugin',
    ]), [
      {
        meta: {
          id: 'registry-test-unloaded-enabled-plugin',
          name: 'Enabled Unloaded Plugin',
          version: '1.0.0',
          description: 'Enabled plugin with unloaded renderer contribution',
          developer: 'Linnya',
          builtin: true,
          required: false,
          ownedFileTypes: [{
            nodeType: 'registry-test-unloaded-enabled-map',
            extension: '.map',
            label: '启用但未加载导图',
          }],
        },
        state: 'enabled',
      },
    ]);

    expect(availability).toMatchObject({
      state: 'load-failed',
      pluginId: 'registry-test-unloaded-enabled-plugin',
      pluginName: 'Enabled Unloaded Plugin',
      label: '启用但未加载导图',
      extension: '.map',
    });
    expect(buildDocumentTypeUnavailableMessage(availability, unavailableMessage)).toContain('前端入口加载失败');
    expect(buildDocumentTypeUnavailableMessage(availability, unavailableMessage)).not.toContain('安装后可打开');
  });

  it('renderer contribution 注册中途失败时不留下半注册的文档类型和工具卡', () => {
    registerRendererPlugin({
      meta: {
        id: 'registry-test-existing-tool',
        name: 'Registry Test Existing Tool',
        version: '1.0.0',
        description: 'Existing tool card conflict owner',
        developer: 'Linnya',
        builtin: true,
      },
      toolCards: {
        registry_test_conflict_tool: {
          component: TestSurface,
        },
      },
    });

    expect(() => registerRendererPlugin({
      meta: {
        id: 'registry-test-partial-plugin',
        name: 'Registry Test Partial Plugin',
        version: '1.0.0',
        description: 'Partial registration rollback test',
        developer: 'Linnya',
        builtin: false,
      },
      documentTypes: [{
        pluginId: 'registry-test-partial-plugin',
        nodeType: 'registry-test-partial-doc',
        activeDocumentType: 'registry-test-partial-editor',
        fileSessionType: 'registry-test-partial-session',
        createRequestType: 'registry-test-partial-doc',
        createBackend: 'workspace-document',
        surfaceComponent: TestSurface,
        label: '半注册文档',
        createLabel: '新建半注册文档',
        defaultName: '未命名半注册文档',
        iconComponent: TestSurface,
        iconClass: 'partial-icon',
        createPriority: 30,
        entityReferences: [{
          kind: 'document',
          uriPattern: 'linnya://registry-test/partial/{documentId}',
          description: '半注册测试文档实体。',
        }],
      }],
      toolCards: {
        registry_test_conflict_tool: {
          component: TestSurface,
        },
      },
    })).toThrow('toolCard 冲突');

    expect(hasRendererPlugin('registry-test-partial-plugin')).toBe(false);
    expect(getDocumentTypeByNodeType('registry-test-partial-doc')).toBeNull();
    expect(Object.keys(listToolCards(new Set(['registry-test-existing-tool', 'registry-test-partial-plugin']))))
      .toEqual(['registry_test_conflict_tool']);
  });

  it('输入贡献冲突时不执行插件 activate，并回滚本次先注册的 kind', async () => {
    const pluginId = 'registry-test-conversation-conflict';
    registerConversationReferenceProvider({
      pluginId,
      id: 'documents',
      query: async () => [],
      resolveReference: candidate => ({ text: candidate.label }),
    });
    const activate = vi.fn();
    registerRendererPlugin({
      meta: {
        id: pluginId,
        name: 'Registry Conversation Conflict Test',
        version: '1.0.0',
        description: 'Conversation input activation conflict test',
        developer: 'Linnya',
        builtin: false,
      },
      activate,
      conversationInput: {
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
          query: async () => [],
          resolveReference: candidate => ({ text: candidate.label }),
        }],
      },
    });

    await expect(activateRendererPlugin(pluginId)).rejects.toThrow(/provider 重复注册/);

    expect(activate).not.toHaveBeenCalled();
    expect(listActiveRendererPluginIds()).toEqual([]);
    expect(readConversationReferenceProviders()).toHaveLength(1);
    expect(() => resolveConversationReferenceChipPresentation({
      id: 'ref-1',
      pluginId,
      kind: 'document',
      label: 'Document 1',
      previewText: 'Document 1',
      text: 'Document 1',
    })).toThrow(/引用类型未注册/);
  });

  it('插件激活 revision 会让 accessory 可见性 computed 失效重算', async () => {
    const pluginId = 'registry-test-accessory-reactivity';
    registerRendererPlugin({
      meta: {
        id: pluginId,
        name: 'Registry Accessory Reactivity Test',
        version: '1.0.0',
        description: 'Conversation input accessory reactive activation test',
        developer: 'Linnya',
        builtin: false,
      },
      conversationInput: {
        referenceKinds: [],
        referenceProviders: [],
        accessories: [{
          pluginId,
          id: 'node-actions',
          component: TestSurface,
        }],
      },
    });

    const visibleAccessories = computed(() => resolveVisibleConversationInputAccessories(
      readConversationInputAccessories(),
      false,
    ));
    expect(visibleAccessories.value).toEqual([]);

    await activateRendererPlugin(pluginId);
    expect(visibleAccessories.value.map(accessory => accessory.id)).toEqual(['node-actions']);

    await deactivateRendererPlugin(pluginId);
    expect(visibleAccessories.value).toEqual([]);
  });

  it('插件 deactivate 失败时保留 active 输入贡献和未发送引用', async () => {
    const pluginId = 'registry-test-conversation-deactivate-fail';
    const deactivate = vi.fn(async () => {
      throw new Error('deactivate failed intentionally');
    });
    registerRendererPlugin({
      meta: {
        id: pluginId,
        name: 'Registry Conversation Deactivate Fail Test',
        version: '1.0.0',
        description: 'Conversation input deactivation failure test',
        developer: 'Linnya',
        builtin: false,
      },
      deactivate,
      conversationInput: {
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
          query: async () => [],
          resolveReference: candidate => ({ text: candidate.label }),
        }],
        accessories: [{
          pluginId,
          id: 'node-actions',
          component: TestSurface,
        }],
      },
    });
    await activateRendererPlugin(pluginId);
    const composerReferences = useComposerReferences();
    composerReferences.addReference({
      pluginId,
      kind: 'document',
      label: 'Document 1',
      previewText: 'Document 1',
      text: 'Document 1',
    });

    await expect(deactivateRendererPlugin(pluginId)).rejects.toThrow('deactivate failed intentionally');

    expect(listActiveRendererPluginIds()).toEqual([pluginId]);
    expect(readConversationReferenceProviders()[0]?.isAvailable?.()).toBe(true);
    expect(readConversationInputAccessories()[0]?.isVisible?.()).toBe(true);
    expect(composerReferences.references.value).toHaveLength(1);
    expect(resolveConversationReferenceChipPresentation(composerReferences.references.value[0]!))
      .toEqual({ label: 'Document 1', preview: 'Document 1' });
  });
});
