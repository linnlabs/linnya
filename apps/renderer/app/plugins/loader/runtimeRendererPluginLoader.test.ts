// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ConversationAgentIds } from '@app/schemas';
import {
  clearRendererPluginRegistryForTest,
  getDocumentTypeByNodeType,
  hasRendererPlugin,
  listActiveRendererPluginIds,
  listConversationAgentChoices,
  listToolCards,
  registerRendererPlugin,
} from '../registry';
import {
  clearConversationReferenceKindsForTest,
  clearConversationReferenceProvidersForTest,
  readConversationReferenceProviders,
  resolveConversationReferenceChipPresentation,
  useComposerReferences,
} from '@/domains/conversation/features/composer-references';
import {
  clearConversationInputAccessoriesForTest,
  readConversationInputAccessories,
} from '@/domains/conversation/features/input-accessories';
import {
  clearDocumentReferenceRuntimeHandlersForTest,
  type DocumentReferenceFocusResult,
  getDocumentReferenceRuntimeHandler,
  registerDocumentReferenceRuntimeHandler,
  unregisterDocumentReferenceRuntimeHandler,
} from '@plugin/renderer/documentReferenceRuntimePort';
import {
  clearRendererPageContextProvidersForTest,
  getRendererPageContextProviderByKind,
  registerRendererPageContextProvider,
  unregisterRendererPageContextProvider,
} from '@plugin/renderer/pageContextProvider';
import {
  clearPluginDocumentCreationHandlersForTest,
  getPluginDocumentCreationHandler,
  registerPluginDocumentCreationHandler,
  unregisterPluginDocumentCreationHandler,
} from '@plugin/renderer/pluginDocumentCreationPort';
import type { OperationResult } from '@plugin/renderer/workspaceRuntime';
import {
  clearRendererToolRefreshHandlersForTest,
  listRendererToolRefreshHandlers,
  registerRendererToolRefreshHandler,
  unregisterRendererToolRefreshHandler,
} from '@plugin/renderer/toolRefreshPort';
import {
  clearSettingsContributionsForTest,
  listSettingsContributions,
  registerSettingsContribution,
  unregisterSettingsContribution,
} from '@plugin/renderer/settingsContribution';
import {
  getRuntimeRendererPluginLoaderDiagnostics,
  loadRuntimeRendererPlugins,
} from './runtimeRendererPluginLoader';

const TestComponent = { name: 'RuntimeRendererPluginLoaderTest', template: '<div />' };

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

beforeEach(() => {
  setActivePinia(createPinia());
  document.head.innerHTML = '';
  clearRendererPluginRegistryForTest();
  clearConversationReferenceKindsForTest();
  clearConversationReferenceProvidersForTest();
  clearConversationInputAccessoriesForTest();
  clearPluginDocumentCreationHandlersForTest();
  clearRendererPageContextProvidersForTest();
  clearRendererToolRefreshHandlersForTest();
  clearDocumentReferenceRuntimeHandlersForTest();
  clearSettingsContributionsForTest();
});

describe('runtime renderer plugin loader', () => {
  it('loads renderer contributions, injects CSS once, and activates once', async () => {
    const activate = vi.fn();
    const importEntry = vi.fn(async (entryUrl: string) => {
      expect(entryUrl).toBe('plugin://runtime-loader-test/dist/renderer/index.js');
      return {
        rendererPlugin: {
          meta: {
            id: 'runtime-loader-test',
            name: 'Runtime Loader Test',
            version: '1.0.0',
            description: 'Runtime renderer plugin loader test',
            developer: 'Linnya',
            builtin: false,
          },
          activate,
          toolCards: {
            runtime_loader_test_tool: {
              component: TestComponent,
            },
          },
        },
      };
    });

    await loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
      importEntry,
      rendererEntriesApi: async () => ({
        success: true,
        data: [{
          pluginId: 'runtime-loader-test',
          version: '1.0.0',
          rendererUiRange: '^2.0.0',
          entryUrl: 'plugin://runtime-loader-test/dist/renderer/index.js',
          cssUrls: [
            'plugin://runtime-loader-test/dist/renderer/assets/style.css',
            'plugin://runtime-loader-test/dist/renderer/assets/style.css',
          ],
        }],
      }),
    });

    await loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
      importEntry,
      rendererEntriesApi: async () => ({
        success: true,
        data: [{
          pluginId: 'runtime-loader-test',
          version: '1.0.0',
          rendererUiRange: '^2.0.0',
          entryUrl: 'plugin://runtime-loader-test/dist/renderer/index.js',
          cssUrls: [
            'plugin://runtime-loader-test/dist/renderer/assets/style.css',
          ],
        }],
      }),
    });

    expect(hasRendererPlugin('runtime-loader-test')).toBe(true);
    expect(importEntry).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(listActiveRendererPluginIds()).toEqual(['runtime-loader-test']);
    expect(document.querySelectorAll('link[data-linnya-plugin-css]')).toHaveLength(1);
    expect(document.querySelector('link[data-linnya-plugin-css]')?.getAttribute('href'))
      .toBe('plugin://runtime-loader-test/dist/renderer/assets/style.css');
  });

  it('串行提交并发插件快照，安装后的卸载同步不会丢失或重复激活', async () => {
    const activationStarted = createDeferred<void>();
    const allowActivationToFinish = createDeferred<void>();
    const activate = vi.fn(async () => {
      activationStarted.resolve(undefined);
      await allowActivationToFinish.promise;
    });
    const deactivate = vi.fn();
    const importEntry = vi.fn(async () => ({
      rendererPlugin: {
        meta: {
          id: 'runtime-loader-serialized-test',
          name: 'Runtime Loader Serialized Test',
          version: '1.0.0',
          description: 'Runtime renderer plugin serialized sync test',
          developer: 'Linnya',
          builtin: false,
        },
        activate,
        deactivate,
      },
    }));
    const secondEntriesApi = vi.fn(async () => ({ success: true, data: [] }));

    const installSync = loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
      importEntry,
      rendererEntriesApi: async () => ({
        success: true,
        data: [{
          pluginId: 'runtime-loader-serialized-test',
          version: '1.0.0',
          rendererUiRange: '^2.0.0',
          entryUrl: 'plugin://runtime-loader-serialized-test/dist/renderer/index.js',
          cssUrls: [],
        }],
      }),
    });
    const uninstallSync = loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
      importEntry,
      rendererEntriesApi: secondEntriesApi,
    });

    await activationStarted.promise;
    expect(secondEntriesApi).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledTimes(1);

    allowActivationToFinish.resolve(undefined);
    await Promise.all([installSync, uninstallSync]);

    expect(importEntry).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(listActiveRendererPluginIds()).toEqual([]);
  });

  it('exposes settings contribution facade through official plugin activation', async () => {
    const importEntry = vi.fn(async () => ({
      rendererPlugin: {
        meta: {
          id: 'runtime-loader-settings-test',
          name: 'Runtime Loader Settings Test',
          version: '1.0.0',
          description: 'Runtime renderer plugin settings test',
          developer: 'Linnya',
          builtin: false,
        },
        activate() {
          registerSettingsContribution({
            id: 'runtime-loader-settings-test',
            title: 'Runtime Settings',
            group: 'document-types',
            order: 70,
            component: TestComponent,
          });
        },
        deactivate() {
          unregisterSettingsContribution('runtime-loader-settings-test');
        },
      },
    }));

    await loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
      importEntry,
      rendererEntriesApi: async () => ({
        success: true,
        data: [{
          pluginId: 'runtime-loader-settings-test',
          version: '1.0.0',
          rendererUiRange: '^2.0.0',
          entryUrl: 'plugin://runtime-loader-settings-test/dist/renderer/index.js',
          cssUrls: [],
        }],
      }),
    });

    expect(listSettingsContributions().map((item) => item.id)).toEqual(['runtime-loader-settings-test']);
  });

  it('activates already registered contributions and still injects runtime CSS', async () => {
    const activate = vi.fn();
    registerRendererPlugin({
      meta: {
        id: 'runtime-loader-registered-test',
        name: 'Runtime Loader Registered Test',
        version: '1.0.0',
        description: 'Already registered runtime renderer plugin test',
        developer: 'Linnya',
        builtin: false,
      },
      stylesheets: ['builtin://runtime-loader-registered-test/style.css'],
      activate,
    });

    const importEntry = vi.fn(async () => ({
      rendererPlugin: {
        meta: {
          id: 'runtime-loader-registered-test',
          name: 'Runtime Loader Registered Test',
          version: '1.0.0',
          description: 'Already registered runtime renderer plugin test',
          developer: 'Linnya',
          builtin: false,
        },
      },
    }));

    await loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
      importEntry,
      rendererEntriesApi: async () => ({
        success: true,
        data: [{
          pluginId: 'runtime-loader-registered-test',
          version: '1.0.0',
          rendererUiRange: '^2.0.0',
          entryUrl: 'plugin://runtime-loader-registered-test/dist/renderer/index.js',
          cssUrls: ['plugin://runtime-loader-registered-test/dist/renderer/assets/style.css'],
        }],
      }),
    });

    expect(importEntry).not.toHaveBeenCalled();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(listActiveRendererPluginIds()).toEqual(['runtime-loader-registered-test']);
    expect(document.querySelectorAll('link[data-linnya-plugin-css]')).toHaveLength(1);
    expect(document.querySelector('link[data-linnya-plugin-css]')?.getAttribute('data-linnya-plugin-id'))
      .toBe('runtime-loader-registered-test');
  });

  it('injects registered contribution stylesheets when runtime entries have no artifact CSS', async () => {
    registerRendererPlugin({
      meta: {
        id: 'runtime-loader-builtin-style-test',
        name: 'Runtime Loader Builtin Style Test',
        version: '1.0.0',
        description: 'Already registered contribution stylesheet test',
        developer: 'Linnya',
        builtin: true,
      },
      stylesheets: ['/@fs/packages/plugins/demo/src/renderer/style.css'],
    });

    await loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
      importEntry: vi.fn(async () => ({ rendererPlugin: null })),
      rendererEntriesApi: async () => ({
        success: true,
        data: [{
          pluginId: 'runtime-loader-builtin-style-test',
          version: '1.0.0',
          rendererUiRange: '^2.0.0',
          entryUrl: 'plugin://runtime-loader-builtin-style-test/dist/renderer/index.js',
          cssUrls: [],
        }],
      }),
    });

    expect(document.querySelectorAll('link[data-linnya-plugin-css]')).toHaveLength(1);
    expect(document.querySelector('link[data-linnya-plugin-css]')?.getAttribute('href'))
      .toBe('/@fs/packages/plugins/demo/src/renderer/style.css');
  });

  it('deactivates plugins missing from the latest enabled renderer entries and removes their CSS', async () => {
    const activate = vi.fn();
    const deactivate = vi.fn();
    const importEntry = vi.fn(async () => ({
      rendererPlugin: {
        meta: {
          id: 'runtime-loader-toggle-test',
          name: 'Runtime Loader Toggle Test',
          version: '1.0.0',
          description: 'Runtime renderer plugin toggle test',
          developer: 'Linnya',
          builtin: false,
        },
        activate,
        deactivate,
      },
    }));

    await loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
      importEntry,
      rendererEntriesApi: async () => ({
        success: true,
        data: [{
          pluginId: 'runtime-loader-toggle-test',
          version: '1.0.0',
          rendererUiRange: '^2.0.0',
          entryUrl: 'plugin://runtime-loader-toggle-test/dist/renderer/index.js',
          cssUrls: ['plugin://runtime-loader-toggle-test/dist/renderer/assets/style.css'],
        }],
      }),
    });
    await loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
      importEntry,
      rendererEntriesApi: async () => ({
        success: true,
        data: [],
      }),
    });

    expect(activate).toHaveBeenCalledTimes(1);
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(listActiveRendererPluginIds()).toEqual([]);
    expect(document.querySelectorAll('link[data-linnya-plugin-css]')).toHaveLength(0);
  });

  it('lets plugin deactivate unregister renderer ports so disabled plugins leave no active handlers', async () => {
    const importEntry = vi.fn(async () => ({
      rendererPlugin: {
        meta: {
          id: 'runtime-loader-port-test',
          name: 'Runtime Loader Port Test',
          version: '1.0.0',
          description: 'Runtime renderer plugin port lifecycle test',
          developer: 'Linnya',
          builtin: false,
        },
        activate() {
          registerPluginDocumentCreationHandler({
            id: 'runtime-loader-port-test.create',
            createDocument: vi.fn(async (): Promise<OperationResult<{ documentId: string }>> => ({
              success: true,
              data: { documentId: 'doc-1' },
            })),
          });
          registerRendererPageContextProvider({
            id: 'runtime-loader-port-test.page-context',
            kind: 'runtime-loader-port-test',
            documentType: 'runtime-loader-port-test',
          });
          registerRendererToolRefreshHandler({
            id: 'runtime-loader-port-test.tool-refresh',
            useTrigger: vi.fn(),
          });
          registerDocumentReferenceRuntimeHandler({
            documentType: 'runtime-loader-port-test',
            getCurrentDocumentId: () => null,
            listReferenceIds: vi.fn(async () => []),
            waitForDocumentReady: vi.fn(async () => false),
            focusReference: vi.fn(async (): Promise<DocumentReferenceFocusResult> => ({
              status: 'document-not-ready',
            })),
          });
        },
        deactivate() {
          unregisterPluginDocumentCreationHandler('runtime-loader-port-test.create');
          unregisterRendererPageContextProvider('runtime-loader-port-test.page-context');
          unregisterRendererToolRefreshHandler('runtime-loader-port-test.tool-refresh');
          unregisterDocumentReferenceRuntimeHandler('runtime-loader-port-test');
        },
      },
    }));

    await loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
      importEntry,
      rendererEntriesApi: async () => ({
        success: true,
        data: [{
          pluginId: 'runtime-loader-port-test',
          version: '1.0.0',
          rendererUiRange: '^2.0.0',
          entryUrl: 'plugin://runtime-loader-port-test/dist/renderer/index.js',
          cssUrls: ['plugin://runtime-loader-port-test/dist/renderer/assets/style.css'],
        }],
      }),
    });

    expect(getPluginDocumentCreationHandler('runtime-loader-port-test.create')).toBeTruthy();
    expect(getRendererPageContextProviderByKind('runtime-loader-port-test')).toBeTruthy();
    expect(listRendererToolRefreshHandlers().map((handler) => handler.id))
      .toContain('runtime-loader-port-test.tool-refresh');
    expect(getDocumentReferenceRuntimeHandler('runtime-loader-port-test')).toBeTruthy();

    await loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
      importEntry,
      rendererEntriesApi: async () => ({
        success: true,
        data: [],
      }),
    });

    expect(() => getPluginDocumentCreationHandler('runtime-loader-port-test.create'))
      .toThrow('未注册插件文档创建器');
    expect(getRendererPageContextProviderByKind('runtime-loader-port-test')).toBeUndefined();
    expect(listRendererToolRefreshHandlers().map((handler) => handler.id))
      .not.toContain('runtime-loader-port-test.tool-refresh');
    expect(getDocumentReferenceRuntimeHandler('runtime-loader-port-test')).toBeNull();
  });

  it('rejects malformed renderer entry responses before importing code', async () => {
    const importEntry = vi.fn(async () => ({ rendererPlugin: null }));

    await expect(loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
      importEntry,
      rendererEntriesApi: async () => ({
        success: true,
        data: [{ pluginId: 'runtime-loader-bad-test' }],
      }),
    })).rejects.toThrow('renderer 插件入口结构不符合约定');

    expect(importEntry).not.toHaveBeenCalled();
  });

  it('在任何插件 JS 或 CSS 副作用前拒绝不兼容的 Renderer UI range', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const importEntry = vi.fn(async () => ({ rendererPlugin: null }));

    try {
      await loadRuntimeRendererPlugins({
        installHostModules: () => undefined,
        importEntry,
        rendererEntriesApi: async () => ({
          success: true,
          data: [{
            pluginId: 'runtime-loader-incompatible-ui-test',
            version: '1.0.0',
            rendererUiRange: '^1.0.0',
            entryUrl: 'plugin://runtime-loader-incompatible-ui-test/dist/renderer/index.js',
            cssUrls: ['plugin://runtime-loader-incompatible-ui-test/dist/renderer/assets/style.css'],
          }],
        }),
      });
    } finally {
      error.mockRestore();
    }

    expect(importEntry).not.toHaveBeenCalled();
    expect(document.querySelectorAll('link[data-linnya-plugin-css]')).toHaveLength(0);
    expect(getRuntimeRendererPluginLoaderDiagnostics().sync?.failures[0]).toMatchObject({
      phase: 'compatibility-admission',
      entry: {
        pluginId: 'runtime-loader-incompatible-ui-test',
        rendererUiRange: '^1.0.0',
      },
      error: {
        message: expect.stringContaining('要求 Renderer UI ^1.0.0，当前为 2.0.0'),
      },
    });
  });

  it('fails loudly when preload does not expose the renderer entries API', async () => {
    await expect(loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
    })).rejects.toThrow('renderer 插件入口 API 不可用');
  });

  it('ignores a renderer module whose contribution id does not match the enabled entry', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const importEntry = vi.fn(async () => ({
      rendererPlugin: {
        meta: {
          id: 'runtime-loader-wrong-plugin',
          name: 'Runtime Loader Wrong Plugin',
          version: '1.0.0',
          description: 'Runtime renderer plugin wrong id test',
          developer: 'Linnya',
          builtin: false,
        },
      },
    }));

    try {
      await loadRuntimeRendererPlugins({
        installHostModules: () => undefined,
        importEntry,
        rendererEntriesApi: async () => ({
          success: true,
          data: [{
            pluginId: 'runtime-loader-expected-plugin',
            version: '1.0.0',
            rendererUiRange: '^2.0.0',
            entryUrl: 'plugin://runtime-loader-expected-plugin/dist/renderer/index.js',
            cssUrls: ['plugin://runtime-loader-expected-plugin/dist/renderer/assets/style.css'],
          }],
        }),
      });
      expect(error).toHaveBeenCalledWith(
        '[renderer-plugin-loader] sync-failed',
        expect.objectContaining({
          entry: expect.objectContaining({
            pluginId: 'runtime-loader-expected-plugin',
            version: '1.0.0',
            entryUrl: 'plugin://runtime-loader-expected-plugin/dist/renderer/index.js',
          }),
          phase: 'contribution-validate',
          moduleExports: expect.objectContaining({
            exportKeys: ['rendererPlugin'],
            hasRendererPlugin: true,
          }),
          error: expect.objectContaining({
            message: 'renderer 插件 contribution id 与入口不一致: entry=runtime-loader-expected-plugin, contribution=runtime-loader-wrong-plugin',
          }),
          registeredBefore: false,
          registeredAfterCleanup: false,
          activeAfterCleanup: false,
        }),
      );
    } finally {
      error.mockRestore();
    }

    expect(hasRendererPlugin('runtime-loader-wrong-plugin')).toBe(false);
    expect(hasRendererPlugin('runtime-loader-expected-plugin')).toBe(false);
    expect(listActiveRendererPluginIds()).toEqual([]);
    expect(document.querySelectorAll('link[data-linnya-plugin-css]')).toHaveLength(0);
  });

  it('rejects concrete plugin legacy renderer export names in runtime disk entries', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const importEntry = vi.fn(async () => ({
      mindmapRendererPlugin: {
        meta: {
          id: 'mindmap',
          name: 'Mindmap',
          version: '1.0.0',
          description: 'Legacy concrete renderer export test',
          developer: 'Linnya',
          builtin: false,
        },
      },
    }));

    try {
      await loadRuntimeRendererPlugins({
        installHostModules: () => undefined,
        importEntry,
        rendererEntriesApi: async () => ({
          success: true,
          data: [{
            pluginId: 'mindmap',
            version: '1.0.0',
            rendererUiRange: '^2.0.0',
            entryUrl: 'plugin://mindmap/dist/renderer/index.js',
            cssUrls: [],
          }],
        }),
      });
      expect(error).toHaveBeenCalledWith(
        '[renderer-plugin-loader] sync-failed',
        expect.objectContaining({
          phase: 'contribution-validate',
          entry: expect.objectContaining({
            pluginId: 'mindmap',
            entryUrl: 'plugin://mindmap/dist/renderer/index.js',
          }),
          moduleExports: expect.objectContaining({
            exportKeys: ['mindmapRendererPlugin'],
            hasRendererPlugin: false,
            hasDefault: false,
          }),
        }),
      );
    } finally {
      error.mockRestore();
    }

    expect(hasRendererPlugin('mindmap')).toBe(false);
    expect(listActiveRendererPluginIds()).toEqual([]);
  });

  it('rejects renderer contributions with malformed stylesheet declarations', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const importEntry = vi.fn(async () => ({
      rendererPlugin: {
        meta: {
          id: 'runtime-loader-bad-style-test',
          name: 'Runtime Loader Bad Style Test',
          version: '1.0.0',
          description: 'Malformed stylesheet declaration test',
          developer: 'Linnya',
          builtin: false,
        },
        stylesheets: ['plugin://runtime-loader-bad-style-test/dist/renderer/style.css', 42],
      },
    }));

    try {
      await loadRuntimeRendererPlugins({
        installHostModules: () => undefined,
        importEntry,
        rendererEntriesApi: async () => ({
          success: true,
          data: [{
            pluginId: 'runtime-loader-bad-style-test',
            version: '1.0.0',
            rendererUiRange: '^2.0.0',
            entryUrl: 'plugin://runtime-loader-bad-style-test/dist/renderer/index.js',
            cssUrls: [],
          }],
        }),
      });
      expect(error).toHaveBeenCalledWith(
        '[renderer-plugin-loader] sync-failed',
        expect.objectContaining({
          phase: 'contribution-validate',
          entry: expect.objectContaining({
            pluginId: 'runtime-loader-bad-style-test',
          }),
          moduleExports: expect.objectContaining({
            hasRendererPlugin: true,
            rendererPluginLooksLikeContribution: false,
          }),
        }),
      );
    } finally {
      error.mockRestore();
    }

    expect(hasRendererPlugin('runtime-loader-bad-style-test')).toBe(false);
    expect(document.querySelectorAll('link[data-linnya-plugin-css]')).toHaveLength(0);
  });

  it('只在插件 active 期间暴露 conversation input，并在停用时清理 draft 引用', async () => {
    const pluginId = 'runtime-loader-conversation-input-test';
    const entry = {
      pluginId,
      version: '1.0.0',
      rendererUiRange: '^2.0.0',
      entryUrl: `plugin://${pluginId}/dist/renderer/index.js`,
      cssUrls: [],
    };
    const activate = vi.fn(() => {
      expect(readConversationReferenceProviders()).toHaveLength(1);
      expect(readConversationReferenceProviders()[0]?.isAvailable?.()).toBe(false);
      expect(readConversationInputAccessories()[0]?.isVisible?.()).toBe(false);
    });
    const deactivate = vi.fn(() => {
      expect(readConversationReferenceProviders()[0]?.isAvailable?.()).toBe(true);
      expect(readConversationInputAccessories()[0]?.isVisible?.()).toBe(true);
    });
    const importEntry = vi.fn(async () => ({
      rendererPlugin: {
        meta: {
          id: pluginId,
          name: 'Runtime Loader Conversation Input Test',
          version: '1.0.0',
          description: 'Conversation input lifecycle test',
          developer: 'Linnya',
          builtin: false,
        },
        activate,
        deactivate,
        conversationInput: {
          referenceKinds: [{
            pluginId,
            kind: 'document',
            chip: {
              label: (reference: { readonly label: string }) => reference.label,
              preview: (reference: { readonly previewText: string }) => reference.previewText,
            },
          }],
          referenceProviders: [{
            pluginId,
            id: 'documents',
            query: async () => [{ id: 'doc-1', label: 'Document 1' }],
            resolveReference: (candidate: { readonly label: string }) => ({
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
            component: TestComponent,
          }],
        },
      },
    }));

    await loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
      importEntry,
      rendererEntriesApi: async () => ({ success: true, data: [entry] }),
    });

    expect(readConversationReferenceProviders()[0]?.isAvailable?.()).toBe(true);
    expect(readConversationInputAccessories()[0]?.isVisible?.()).toBe(true);
    expect(resolveConversationReferenceChipPresentation({
      id: 'ref-1',
      pluginId,
      kind: 'document',
      label: 'Document 1',
      previewText: 'Document 1',
      text: 'Document 1',
    })).toEqual({ label: 'Document 1', preview: 'Document 1' });
    const composerReferences = useComposerReferences();
    composerReferences.addReference({
      pluginId,
      kind: 'document',
      label: 'Document 1',
      previewText: 'Document 1',
      text: 'Document 1',
    });
    expect(composerReferences.references.value).toHaveLength(1);

    await loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
      importEntry,
      rendererEntriesApi: async () => ({ success: true, data: [] }),
    });

    expect(readConversationReferenceProviders()).toEqual([]);
    expect(readConversationInputAccessories()).toEqual([]);
    expect(composerReferences.references.value).toEqual([]);
    expect(() => resolveConversationReferenceChipPresentation({
      id: 'ref-1',
      pluginId,
      kind: 'document',
      label: 'Document 1',
      previewText: 'Document 1',
      text: 'Document 1',
    })).toThrow(/引用类型未注册/);

    await loadRuntimeRendererPlugins({
      installHostModules: () => undefined,
      importEntry,
      rendererEntriesApi: async () => ({ success: true, data: [entry] }),
    });

    expect(importEntry).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledTimes(2);
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(readConversationReferenceProviders()[0]?.isAvailable?.()).toBe(true);
    expect(readConversationInputAccessories()[0]?.isVisible?.()).toBe(true);
  });

  it('rolls back newly loaded contributions when activate fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const importEntry = vi.fn(async () => ({
      rendererPlugin: {
        meta: {
          id: 'runtime-loader-activate-fail-test',
          name: 'Runtime Loader Activate Fail Test',
          version: '1.0.0',
          description: 'Activation rollback test',
          developer: 'Linnya',
          builtin: false,
        },
        documentTypes: [{
          pluginId: 'runtime-loader-activate-fail-test',
          nodeType: 'runtime-loader-activate-fail-doc',
          activeDocumentType: 'runtime-loader-activate-fail-editor',
          fileSessionType: 'runtime-loader-activate-fail-session',
          createRequestType: 'runtime-loader-activate-fail-doc',
          createBackend: 'workspace-document',
          surfaceComponent: TestComponent,
          label: '激活失败文档',
          createLabel: '新建激活失败文档',
          defaultName: '未命名激活失败文档',
          iconComponent: TestComponent,
          iconClass: 'activate-fail-icon',
          createPriority: 40,
          entityReferences: [{
            kind: 'document',
            uriPattern: 'linnya://runtime-loader/activate-fail/{documentId}',
            description: '激活失败测试文档实体。',
          }],
        }],
        toolCards: {
          runtime_loader_activate_fail_tool: {
            component: TestComponent,
          },
        },
        conversationAgentChoices: [{
          id: 'runtime-loader-activate-fail-agent-choice',
          agentId: ConversationAgentIds.DEEP_RESEARCH,
          menuText: '激活失败流程',
          pillText: '失败流程',
          ariaLabel: '激活失败流程',
          iconComponent: TestComponent,
        }],
        conversationInput: {
          referenceKinds: [{
            pluginId: 'runtime-loader-activate-fail-test',
            kind: 'document',
            chip: {
              label: (reference: { readonly label: string }) => reference.label,
              preview: (reference: { readonly previewText: string }) => reference.previewText,
            },
          }],
          referenceProviders: [{
            pluginId: 'runtime-loader-activate-fail-test',
            id: 'documents',
            query: async () => [],
            resolveReference: (candidate: { readonly label: string }) => ({
              text: candidate.label,
            }),
          }],
        },
        activate() {
          throw new Error('activate failed intentionally');
        },
      },
    }));

    try {
      await loadRuntimeRendererPlugins({
        installHostModules: () => undefined,
        importEntry,
        rendererEntriesApi: async () => ({
          success: true,
          data: [{
            pluginId: 'runtime-loader-activate-fail-test',
            version: '1.0.0',
            rendererUiRange: '^2.0.0',
            entryUrl: 'plugin://runtime-loader-activate-fail-test/dist/renderer/index.js',
            cssUrls: ['plugin://runtime-loader-activate-fail-test/dist/renderer/assets/style.css'],
          }],
        }),
      });
      expect(error).toHaveBeenCalledWith(
        '[renderer-plugin-loader] sync-failed',
        expect.objectContaining({
          phase: 'activate-start',
          entry: expect.objectContaining({
            pluginId: 'runtime-loader-activate-fail-test',
            entryUrl: 'plugin://runtime-loader-activate-fail-test/dist/renderer/index.js',
          }),
          contribution: expect.objectContaining({
            meta: expect.objectContaining({
              id: 'runtime-loader-activate-fail-test',
            }),
            documentTypes: [expect.objectContaining({
              nodeType: 'runtime-loader-activate-fail-doc',
            })],
            toolCards: ['runtime_loader_activate_fail_tool'],
            conversationAgentChoices: ['runtime-loader-activate-fail-agent-choice'],
            conversationInput: {
              referenceKinds: ['document'],
              referenceProviders: ['documents'],
              accessories: [],
            },
          }),
          registeredAfterCleanup: false,
          activeAfterCleanup: false,
          error: expect.objectContaining({
            message: 'activate failed intentionally',
          }),
        }),
      );
    } finally {
      error.mockRestore();
    }

    expect(hasRendererPlugin('runtime-loader-activate-fail-test')).toBe(false);
    expect(listActiveRendererPluginIds()).toEqual([]);
    expect(getDocumentTypeByNodeType('runtime-loader-activate-fail-doc')).toBeNull();
    expect(Object.keys(listToolCards(new Set(['runtime-loader-activate-fail-test'])))).toEqual([]);
    expect(listConversationAgentChoices(new Set(['runtime-loader-activate-fail-test']))).toEqual([]);
    expect(readConversationReferenceProviders()).toEqual([]);
    expect(() => resolveConversationReferenceChipPresentation({
      id: 'ref-1',
      pluginId: 'runtime-loader-activate-fail-test',
      kind: 'document',
      label: 'Document 1',
      previewText: 'Document 1',
      text: 'Document 1',
    })).toThrow(/引用类型未注册/);
    expect(document.querySelectorAll('link[data-linnya-plugin-css]')).toHaveLength(0);
  });
});
