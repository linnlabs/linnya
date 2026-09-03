import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type {
  ConversationCleanupRetryOutcome,
} from '@app/schemas';
import type {
  ConversationListResponse,
  ConversationMetadata,
} from '../services/historyApiService';

const deleteConversationMock = vi.hoisted(() => vi.fn<(conversationId: string) => Promise<boolean>>());
const retryPendingCleanupMock = vi.hoisted(() => (
  vi.fn<(conversationId: string) => Promise<ConversationCleanupRetryOutcome>>()
));
const fetchMetadataMock = vi.hoisted(() => (
  vi.fn<(conversationId: string) => Promise<ConversationMetadata | null>>()
));
const fetchListMock = vi.hoisted(() => (
  vi.fn<() => Promise<ConversationListResponse>>()
));
const loadHistoryWindowTailMock = vi.hoisted(() => (
  vi.fn<(conversationId: string, limit: number) => Promise<'ready' | 'preparing'>>()
));
const restoreInteractiveRunMock = vi.hoisted(() => (
  vi.fn<(conversationId: string) => Promise<void>>()
));

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
    configurable: true,
  });
});

vi.mock('../services/historyApiService', () => ({
  historyApiService: {
    deleteConversation: deleteConversationMock,
    retryPendingCleanup: retryPendingCleanupMock,
    fetchMetadata: fetchMetadataMock,
    fetchList: fetchListMock,
  },
}));

vi.mock('./historyWindowTailLoader', () => ({
  loadHistoryWindowTail: loadHistoryWindowTailMock,
}));

vi.mock('../../features/interactive-run/orchestration/restoreInteractiveRun', () => ({
  restoreInteractiveRun: restoreInteractiveRunMock,
}));

vi.mock('../../../../shared/stores/ui', () => ({
  useUIStore: () => ({
    getEditor: vi.fn(() => null),
  }),
}));

vi.mock('../../services/orchestration/toolingFlowOrchestrator', () => ({
  useToolingFlowOrchestrator: () => ({
    concludeAskQuestionsInteraction: vi.fn(),
    concludeInteractiveToolInteraction: vi.fn(),
  }),
}));

vi.mock('../../services/orchestration/annotationRunOrchestrator', () => ({
  useAnnotationRunOrchestrator: () => ({
    executeAnnotationRun: vi.fn(),
    cancelAnnotationRun: vi.fn(),
  }),
}));

vi.mock('../../services/assistantService', () => ({}));

vi.mock('@/domains/workspace/services/file-manager', () => ({
  activateFileSession: vi.fn(),
  getActiveFileSession: vi.fn(() => null),
  saveDeactivateThen: vi.fn(async (action: () => void | Promise<void>) => action()),
}));

vi.mock('@/domains/workspace/store/WorkspaceTreeStore', () => ({
  useWorkspaceTreeStore: () => ({
    findNodeById: vi.fn(() => null),
  }),
}));

import { useWorkspaceScopeStore, type WorkspaceScope } from '../../../../shared/stores/workspaceScopeStore';
import { createWorkspaceNavigation } from '../../../../app/layout/orchestration/workspaceNavigation';
import { useConversationTitleCandidateStore } from '../../features/conversation-title/store/conversationTitleCandidateStore';
import { useInteractiveRunStore } from '../../features/interactive-run';
import { useMessageWindowStore } from '../../message-window/store/messageWindowStore';
import { useProjectionStore } from '../../store/assistant/projectionStore';
import { useAssistantStore } from '../../store/assistantStore';
import { useConversationState } from '../../store/conversationState';
import { createTestUserMessage } from '../../testing/functions/createConversationTestMessage';
import { useConversationDeletionStore } from '../store/conversationDeletionStore';
import { useHistoryListStore } from '../store/historyListStore';
import { useHistoryLoaderStore } from '../store/historyLoaderStore';
import {
  deleteConversationFromHistory,
  retryConversationCleanupFromHistory,
} from './deleteConversationFromHistory';

interface DeferredPromise<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function createDeferredPromise<T>(): DeferredPromise<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  if (!resolvePromise || !rejectPromise) {
    throw new Error('deferred promise was not initialized synchronously');
  }
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

const assistantScope: WorkspaceScope = { kind: 'linnya-assistant' };

function seedConversation(
  conversationId: string,
  options: { readonly active: boolean },
): AbortController {
  const workspaceScopeStore = useWorkspaceScopeStore();
  const conversationState = useConversationState();
  const assistantStore = useAssistantStore();
  const historyListStore = useHistoryListStore();
  const titleCandidateStore = useConversationTitleCandidateStore();

  conversationState.createConversation({
    id: conversationId,
    title: `对话 ${conversationId}`,
    autoActivate: options.active,
  });
  historyListStore.upsertConversation({
    conversation_id: conversationId,
    title: `对话 ${conversationId}`,
    created_at: 1,
    last_event_at: 2,
    event_count: 1,
    user_message_count: 1,
    project_id: null,
    is_pinned: false,
    selected_agent_id: null,
  });
  titleCandidateStore.registerCandidate(conversationId);

  if (options.active) {
    workspaceScopeStore.materializeCurrentDraft(conversationId);
    assistantStore.setSelectedConversation(conversationId);
    useMessageWindowStore().setPreparing(conversationId);
  }

  assistantStore.appendMessage(
    createTestUserMessage({ id: `message-${conversationId}` }),
    conversationId,
  );
  const runController = new AbortController();
  useInteractiveRunStore().beginStart(conversationId, runController);
  return runController;
}

function expectConversationFactsPresent(conversationId: string): void {
  expect(useHistoryListStore().getConversationsByScope(assistantScope)).toEqual(
    expect.arrayContaining([expect.objectContaining({ conversation_id: conversationId })]),
  );
  expect(useConversationState().conversations.some(conversation => conversation.id === conversationId)).toBe(true);
  expect(useProjectionStore().messageProjectionStates.has(conversationId)).toBe(true);
  expect(useInteractiveRunStore().snapshotFor(conversationId)).toMatchObject({
    conversationId,
    status: 'starting',
  });
  expect(useConversationTitleCandidateStore().getCandidate(conversationId)).not.toBeNull();
}

describe('deleteConversationFromHistory', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    deleteConversationMock.mockReset();
    retryPendingCleanupMock.mockReset();
    fetchMetadataMock.mockReset();
    fetchListMock.mockReset();
    fetchListMock.mockResolvedValue({
      conversations: [],
      hasMore: false,
    });
    loadHistoryWindowTailMock.mockReset();
    restoreInteractiveRunMock.mockReset();
  });

  it('等待后端期间保留全部事实并合并重复删除，成功后原子清理当前对话', async () => {
    const deferredDelete = createDeferredPromise<boolean>();
    deleteConversationMock.mockReturnValue(deferredDelete.promise);
    const runController = seedConversation('conversation-active', { active: true });

    const firstDeletion = deleteConversationFromHistory({
      conversationId: 'conversation-active',
      scope: assistantScope,
    });
    const repeatedDeletion = deleteConversationFromHistory({
      conversationId: 'conversation-active',
      scope: assistantScope,
    });

    expect(repeatedDeletion).toBe(firstDeletion);
    expect(deleteConversationMock).toHaveBeenCalledTimes(1);
    expect(useConversationDeletionStore().isDeletingConversation('conversation-active')).toBe(true);
    expectConversationFactsPresent('conversation-active');
    expect(useConversationState().activeConversationId).toBe('conversation-active');
    expect(useAssistantStore().selectedConversationId).toBe('conversation-active');
    expect(useMessageWindowStore().conversationId).toBe('conversation-active');
    expect(runController.signal.aborted).toBe(false);

    deferredDelete.resolve(true);
    await firstDeletion;

    expect(useConversationDeletionStore().isDeletingConversation('conversation-active')).toBe(false);
    expect(useHistoryListStore().getConversationsByScope(assistantScope)).toHaveLength(0);
    expect(useConversationState().conversations).toHaveLength(0);
    expect(useConversationState().activeConversationId).toBeNull();
    expect(useAssistantStore().selectedConversationId).toBeNull();
    expect(useMessageWindowStore().conversationId).toBeNull();
    expect(useProjectionStore().messageProjectionStates.has('conversation-active')).toBe(false);
    expect(useInteractiveRunStore().snapshotFor('conversation-active')).toBeUndefined();
    expect(runController.signal.aborted).toBe(true);
    expect(useConversationTitleCandidateStore().getCandidate('conversation-active')).toBeNull();
    expect(useWorkspaceScopeStore().isCurrentScopeDraft).toBe(true);
    expect(useWorkspaceScopeStore().getLastActiveConversation(assistantScope)).toBeNull();
  });

  it('后端失败时不清任何事实，结束 pending 后允许用户重试', async () => {
    deleteConversationMock.mockRejectedValueOnce(new Error('delete failed'));
    seedConversation('conversation-retry', { active: true });

    await expect(deleteConversationFromHistory({
      conversationId: 'conversation-retry',
      scope: assistantScope,
    })).rejects.toThrow('delete failed');

    expect(useConversationDeletionStore().isDeletingConversation('conversation-retry')).toBe(false);
    expectConversationFactsPresent('conversation-retry');
    expect(useConversationState().activeConversationId).toBe('conversation-retry');
    expect(useAssistantStore().selectedConversationId).toBe('conversation-retry');
    expect(useMessageWindowStore().conversationId).toBe('conversation-retry');

    deleteConversationMock.mockResolvedValueOnce(true);
    await deleteConversationFromHistory({
      conversationId: 'conversation-retry',
      scope: assistantScope,
    });

    expect(deleteConversationMock).toHaveBeenCalledTimes(2);
    expect(useConversationState().activeConversationId).toBeNull();
  });

  it('工作目录清理重试成功后解除持久状态，但保留对话事实', async () => {
    retryPendingCleanupMock.mockResolvedValue('work_directory_cleared');
    seedConversation('conversation-clear-retry', { active: false });
    useHistoryListStore().updateConversation('conversation-clear-retry', {
      cleanup_pending: true,
    });

    await retryConversationCleanupFromHistory({
      conversationId: 'conversation-clear-retry',
      scope: assistantScope,
    });

    expectConversationFactsPresent('conversation-clear-retry');
    expect(useHistoryListStore().getConversationsByScope(assistantScope)[0])
      .toMatchObject({ cleanup_pending: false });
  });

  it('删除任务重试成功后复用同一 Renderer 删除提交', async () => {
    retryPendingCleanupMock.mockResolvedValue('conversation_deleted');
    seedConversation('conversation-delete-retry', { active: true });

    await retryConversationCleanupFromHistory({
      conversationId: 'conversation-delete-retry',
      scope: assistantScope,
    });

    expect(useHistoryListStore().getConversationsByScope(assistantScope)).toHaveLength(0);
    expect(useConversationState().activeConversationId).toBeNull();
    expect(useProjectionStore().messageProjectionStates.has('conversation-delete-retry')).toBe(false);
  });

  it('重试仍失败时保留 cleanup 状态和全部本地事实', async () => {
    retryPendingCleanupMock.mockRejectedValue(new Error('cleanup failed again'));
    seedConversation('conversation-cleanup-still-failed', { active: false });
    useHistoryListStore().updateConversation('conversation-cleanup-still-failed', {
      cleanup_pending: true,
    });

    await expect(retryConversationCleanupFromHistory({
      conversationId: 'conversation-cleanup-still-failed',
      scope: assistantScope,
    })).rejects.toThrow('cleanup failed again');

    expectConversationFactsPresent('conversation-cleanup-still-failed');
    expect(useHistoryListStore().getConversationsByScope(assistantScope)[0])
      .toMatchObject({ cleanup_pending: true });
  });

  it('删除后台对话只释放目标状态，不切换当前正文', async () => {
    deleteConversationMock.mockResolvedValue(true);
    seedConversation('conversation-visible', { active: true });
    seedConversation('conversation-background', { active: false });

    await deleteConversationFromHistory({
      conversationId: 'conversation-background',
      scope: assistantScope,
    });

    expect(useConversationState().activeConversationId).toBe('conversation-visible');
    expect(useAssistantStore().selectedConversationId).toBe('conversation-visible');
    expect(useMessageWindowStore().conversationId).toBe('conversation-visible');
    expect(useProjectionStore().messageProjectionStates.has('conversation-visible')).toBe(true);
    expect(useInteractiveRunStore().snapshotFor('conversation-visible')).toBeDefined();
    expect(useWorkspaceScopeStore().isCurrentScopeDraft).toBe(false);
    expect(useConversationState().conversations.map(conversation => conversation.id)).toEqual([
      'conversation-visible',
    ]);
    expect(useProjectionStore().messageProjectionStates.has('conversation-background')).toBe(false);
    expect(useInteractiveRunStore().snapshotFor('conversation-background')).toBeUndefined();
  });

  it('等待删除期间切到另一条对话，成功提交不得把新正文切回草稿', async () => {
    const deferredDelete = createDeferredPromise<boolean>();
    deleteConversationMock.mockReturnValue(deferredDelete.promise);
    seedConversation('conversation-leaving', { active: true });
    seedConversation('conversation-next', { active: false });

    const deletion = deleteConversationFromHistory({
      conversationId: 'conversation-leaving',
      scope: assistantScope,
    });

    const conversationState = useConversationState();
    const assistantStore = useAssistantStore();
    const messageWindowStore = useMessageWindowStore();
    conversationState.setActiveConversation('conversation-next');
    assistantStore.setSelectedConversation('conversation-next');
    messageWindowStore.clear();
    messageWindowStore.setPreparing('conversation-next');
    useWorkspaceScopeStore().rememberLastActiveConversation(assistantScope, 'conversation-next');

    deferredDelete.resolve(true);
    await deletion;

    expect(conversationState.activeConversationId).toBe('conversation-next');
    expect(assistantStore.selectedConversationId).toBe('conversation-next');
    expect(messageWindowStore.conversationId).toBe('conversation-next');
    expect(useWorkspaceScopeStore().isCurrentScopeDraft).toBe(false);
    expect(useWorkspaceScopeStore().getLastActiveConversation(assistantScope)).toBe('conversation-next');
  });

  it('等待删除期间切换工作区，成功提交不得撤销用户较新的导航', async () => {
    const deferredDelete = createDeferredPromise<boolean>();
    deleteConversationMock.mockReturnValue(deferredDelete.promise);
    seedConversation('conversation-scope-leaving', { active: true });
    const deletion = deleteConversationFromHistory({
      conversationId: 'conversation-scope-leaving',
      scope: assistantScope,
    });

    const workspaceScopeStore = useWorkspaceScopeStore();
    workspaceScopeStore.enterProject('project-newer-navigation');
    expect(workspaceScopeStore.currentScope).toEqual({
      kind: 'project',
      projectId: 'project-newer-navigation',
    });

    deferredDelete.resolve(true);
    await deletion;

    expect(workspaceScopeStore.currentScope).toEqual({
      kind: 'project',
      projectId: 'project-newer-navigation',
    });
    expect(useConversationState().activeConversationId).toBeNull();
  });

  it('删除正在加载的对话后，迟到 metadata 不得复活本地 read model', async () => {
    const deferredMetadata = createDeferredPromise<null>();
    fetchMetadataMock.mockReturnValue(deferredMetadata.promise);
    deleteConversationMock.mockResolvedValue(true);
    const historyLoaderStore = useHistoryLoaderStore();
    const loadPromise = historyLoaderStore.loadConversation('conversation-loading', {
      initialConversation: {
        title: '加载中的对话',
        created_at: 1,
        last_event_at: 2,
        project_id: null,
      },
    });

    expect(historyLoaderStore.loadingConversationId).toBe('conversation-loading');
    expect(useConversationState().activeConversationId).toBe('conversation-loading');

    await deleteConversationFromHistory({
      conversationId: 'conversation-loading',
      scope: assistantScope,
    });
    deferredMetadata.resolve(null);
    await loadPromise;

    expect(historyLoaderStore.isLoading).toBe(false);
    expect(historyLoaderStore.loadingConversationId).toBeNull();
    expect(useConversationState().historyLoadingConversationId).toBeNull();
    expect(useConversationState().activeConversationId).toBeNull();
    expect(useConversationState().conversations.some(
      conversation => conversation.id === 'conversation-loading',
    )).toBe(false);
    expect(loadHistoryWindowTailMock).not.toHaveBeenCalled();
    expect(restoreInteractiveRunMock).not.toHaveBeenCalled();
  });

  it('真实导航加载与删除并发时，迟到导航不得重新记录已删除身份', async () => {
    const deferredMetadata = createDeferredPromise<null>();
    fetchMetadataMock.mockReturnValue(deferredMetadata.promise);
    deleteConversationMock.mockResolvedValue(true);
    const conversationId = 'conversation-navigation-deleted';
    const navigation = createWorkspaceNavigation();
    const opening = navigation.openConversation({
      conversationId,
      scope: assistantScope,
      initialConversation: {
        title: '即将删除的会话',
        createdAt: 1,
        lastEventAt: 2,
        projectId: null,
      },
    });
    await Promise.resolve();
    expect(fetchMetadataMock).toHaveBeenCalledWith(conversationId);

    await deleteConversationFromHistory({
      conversationId,
      scope: assistantScope,
    });
    deferredMetadata.resolve(null);
    await opening;

    expect(useWorkspaceScopeStore().getLastActiveConversation(assistantScope)).toBeNull();
    expect(useConversationState().conversations.some(
      conversation => conversation.id === conversationId,
    )).toBe(false);
  });

  it('删除成功后，删除前发出的迟到列表响应不得把对话重新加入侧栏', async () => {
    const deferredList = createDeferredPromise<ConversationListResponse>();
    fetchListMock.mockReturnValue(deferredList.promise);
    deleteConversationMock.mockResolvedValue(true);
    seedConversation('conversation-late-list', { active: true });
    const historyListStore = useHistoryListStore();
    const refreshPromise = historyListStore.loadScopeList(assistantScope, {
      refresh: true,
      limit: 100,
    });

    await deleteConversationFromHistory({
      conversationId: 'conversation-late-list',
      scope: assistantScope,
    });
    deferredList.resolve({
      conversations: [{
        conversation_id: 'conversation-late-list',
        title: '已经删除的旧列表行',
        created_at: 1,
        last_event_at: 2,
        event_count: 1,
        user_message_count: 1,
        project_id: null,
        is_pinned: false,
        selected_agent_id: null,
      }],
      hasMore: false,
    });
    await refreshPromise;

    expect(historyListStore.getConversationsByScope(assistantScope)).toHaveLength(0);
    historyListStore.upsertConversation({
      conversation_id: 'conversation-late-list',
      title: '迟到同步',
      created_at: 1,
      last_event_at: 3,
      event_count: 2,
      user_message_count: 1,
      project_id: null,
      is_pinned: false,
      selected_agent_id: null,
    });
    expect(historyListStore.getConversationsByScope(assistantScope)).toHaveLength(0);
  });
});
