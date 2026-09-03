import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceScope } from '../../../../shared/stores/workspaceScopeStore';
import { startDraftConversation } from './startDraftConversation';

const stores = vi.hoisted(() => ({
  assistant: {
    setSelectedConversation: vi.fn(),
    clearActiveConversation: vi.fn(),
    clearError: vi.fn(),
  },
  conversationSelection: {
    clear: vi.fn(),
  },
  workspaceScope: {
    currentScope: { kind: 'linnya-assistant' } as WorkspaceScope,
    startDraft: vi.fn(),
  },
}));

vi.mock('../../store/assistantStore', () => ({
  useAssistantStore: () => stores.assistant,
}));

vi.mock('../../history/store/conversationSelectionStore', () => ({
  useConversationSelectionStore: () => stores.conversationSelection,
}));

vi.mock('../../../../shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => stores.workspaceScope,
}));

describe('startDraftConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stores.workspaceScope.currentScope = { kind: 'linnya-assistant' };
  });

  it('开启新草稿时结束目标 scope 的旧会话选中状态', () => {
    const scope: WorkspaceScope = { kind: 'project', projectId: 'project-1' };

    startDraftConversation(scope);

    expect(stores.workspaceScope.startDraft).toHaveBeenCalledWith(scope);
    expect(stores.conversationSelection.clear).toHaveBeenCalledWith(scope);
    expect(stores.assistant.setSelectedConversation).toHaveBeenCalledWith(null);
    expect(stores.assistant.clearActiveConversation).toHaveBeenCalledOnce();
    expect(stores.assistant.clearError).toHaveBeenCalledOnce();
  });
});
