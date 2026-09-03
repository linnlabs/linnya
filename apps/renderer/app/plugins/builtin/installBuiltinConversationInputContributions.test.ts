import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, type EffectScope } from 'vue';
import {
  clearConversationReferenceKindsForTest,
  clearConversationReferenceProvidersForTest,
  readConversationReferenceProviders,
  resolveConversationReferenceChipPresentation,
} from '@/domains/conversation/features/composer-references/registration';
import {
  clearConversationInputExtensionsForTest,
} from '@/domains/conversation/features/input-extensions/registration';
import { useActiveConversationInputExtension } from '@/domains/conversation/features/input-extensions';
import {
  clearConversationInputAccessoriesForTest,
  readConversationInputAccessories,
} from '@/domains/conversation/features/input-accessories';
import { useTableAiModeStore } from '@/domains/editor/features/table-ai-mode';
import { TABLE_FILL_CONVERSATION_INPUT_EXTENSION_ID } from '@/app/workflows/table-fill';
import { installBuiltinConversationInputContributions } from './installBuiltinConversationInputContributions';

vi.mock('@/app/workflows/table-fill/orchestration/useTableFillWorkflow', () => ({
  useTableFillWorkflow: () => ({
    submit: vi.fn(async () => {}),
    cancel: vi.fn(),
    deactivate: vi.fn(async () => {}),
  }),
}));

vi.mock('@/shared/ipc/workspaceGateway', () => ({
  workspaceGateway: {
    'get-recent-documents': vi.fn(async () => ({ success: true, data: [] })),
  },
}));

vi.mock('@/shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => ({ currentProjectId: null }),
}));

vi.mock('@/domains/workspace/store', () => ({
  useWorkspaceTreeStore: () => ({
    loadedProjectId: null,
    projectTree: [],
  }),
}));

describe('installBuiltinConversationInputContributions', () => {
  let scope: EffectScope;

  beforeEach(() => {
    scope = effectScope();
    setActivePinia(createPinia());
    clearConversationReferenceKindsForTest();
    clearConversationReferenceProvidersForTest();
    clearConversationInputExtensionsForTest();
    clearConversationInputAccessoriesForTest();
  });

  afterEach(() => {
    scope.stop();
  });

  it('注册 platform 引用、workspace provider 与内置 table 输入扩展', () => {
    scope.run(() => installBuiltinConversationInputContributions());

    expect(resolveConversationReferenceChipPresentation({
      id: 'reference-1',
      pluginId: 'platform',
      kind: 'text-selection',
      label: '引用内容',
      previewText: 'abcdefghijklmnop',
      text: 'abcdefghijklmnop',
    })).toEqual({
      label: '引用内容',
      preview: 'abcd...mnop',
    });

    expect(resolveConversationReferenceChipPresentation({
      id: 'reference-2',
      pluginId: 'platform',
      kind: 'workspace-document',
      label: 'Roadmap',
      previewText: 'Roadmap',
      text: 'workspace reference',
    })).toEqual({
      label: 'Roadmap',
      preview: 'Roadmap',
    });
    expect(readConversationReferenceProviders().map(provider => `${provider.pluginId}:${provider.id}`))
      .toEqual(['platform:workspace-document']);
    expect(readConversationInputAccessories()).toEqual([]);

    useTableAiModeStore().startSession({
      sessionId: 'table-session-1',
      table: {
        editorId: 'editor-1',
        rootBlockId: 'root-1',
        lastKnownPos: 10,
      },
      context: {
        columnRefs: [],
        selectionRange: 'A1:A2',
        outputColumnRange: 'B1:B2',
        activeColumnRefs: {},
        outputRect: { top: 0, bottom: 2, left: 1, right: 2 },
        outputColumnAdded: false,
      },
    });

    expect(useActiveConversationInputExtension().value?.id)
      .toBe(TABLE_FILL_CONVERSATION_INPUT_EXTENSION_ID);
  });
});
