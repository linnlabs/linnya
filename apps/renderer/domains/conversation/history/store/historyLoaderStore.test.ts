import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { ConversationMetadata } from '../services/historyApiService';

const fetchMetadataMock = vi.hoisted(() =>
  vi.fn<(conversationId: string) => Promise<ConversationMetadata | null>>()
);

const loadHistoryWindowTailMock = vi.hoisted(() =>
  vi.fn<(conversationId: string, limit: number) => Promise<'ready' | 'preparing'>>()
);

const restoreInteractiveRunMock = vi.hoisted(() =>
  vi.fn<(conversationId: string) => Promise<void>>()
);

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
    fetchMetadata: fetchMetadataMock,
  },
}));

vi.mock('../orchestration/historyWindowTailLoader', () => ({
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

vi.mock('../../../../shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => ({
    currentScope: { kind: 'linnya-assistant' },
    currentProjectId: null,
    rememberLastActiveConversation: vi.fn(),
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

import { useAssistantStore } from '../../store/assistantStore';
import { useConversationState } from '../../store/conversationState';
import { useHistoryLoaderStore } from './historyLoaderStore';
import { useInteractiveRunStore } from '../../features/interactive-run';
import type { BaseMessage } from '../../types';
import { RunIdSchema, ToolCallIdSchema } from 'linnkit/contracts';

interface DeferredPromise<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferredPromise<T>(): DeferredPromise<T> {
  let resolvePromise: (value: T) => void = () => {};
  let rejectPromise: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function buildUserMessage(id: string, content: string): BaseMessage {
  return {
    id,
    role: 'user',
    type: 'user_input',
    content,
    timestamp: 1,
  };
}

function buildMetadata(conversationId: string): ConversationMetadata {
  return {
    conversation_id: conversationId,
    title: `历史会话 ${conversationId}`,
    created_at: 1,
    last_event_at: 2,
    event_count: 0,
    user_message_count: 0,
    project_id: null,
    is_pinned: false,
    selected_agent_id: null,
    current_revision: 0,
  };
}

describe('historyLoaderStore loading shell handoff', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fetchMetadataMock.mockReset();
    loadHistoryWindowTailMock.mockReset();
    restoreInteractiveRunMock.mockReset();
    fetchMetadataMock.mockImplementation(conversationId =>
      Promise.resolve(buildMetadata(conversationId))
    );
    loadHistoryWindowTailMock.mockResolvedValue('ready');
    restoreInteractiveRunMock.mockResolvedValue(undefined);
  });

  it('复用 navigation 已准备的 loading 壳，不清理 conversation-scoped projection runtime', async () => {
    const loaderStore = useHistoryLoaderStore();
    const assistantStore = useAssistantStore();
    const conversationState = useConversationState();
    const cleanupProjectionSpy = vi.spyOn(assistantStore, 'cleanupConversationProjection');
    const beginBufferSpy = vi.spyOn(assistantStore, 'beginHistoryLoadingSseBuffer');
    const conversationId = 'conversation-handoff';
    const initialConversation = {
      title: '历史会话',
      created_at: 1,
      last_event_at: 2,
      project_id: null,
    };

    const loadingIntent = loaderStore.beginConversationLoadingIntent(conversationId, {
      initialConversation,
    });
    if (!loadingIntent) {
      throw new Error('loading intent should be created');
    }

    const preparedShell = conversationState.conversations.find(
      conversation => conversation.id === conversationId
    );
    expect(preparedShell).toBeTruthy();
    expect(conversationState.historyLoadingConversationId).toBe(conversationId);

    const loadResult = await loaderStore.loadConversation(conversationId, {
      initialConversation,
      loadingIntent,
    });

    expect(loadResult).toEqual({ status: 'committed', conversationId });
    expect(beginBufferSpy).toHaveBeenCalledTimes(1);
    expect(cleanupProjectionSpy).not.toHaveBeenCalled();
    expect(fetchMetadataMock).toHaveBeenCalledTimes(1);
    expect(fetchMetadataMock).toHaveBeenCalledWith(conversationId);
    expect(loadHistoryWindowTailMock).toHaveBeenCalledWith(conversationId, 80);
    expect(restoreInteractiveRunMock).toHaveBeenCalledWith(conversationId);
  });

  it('切换到另一条对话只切换 read model，不取消原对话等待中的 foreground run', async () => {
    const loaderStore = useHistoryLoaderStore();
    const assistantStore = useAssistantStore();
    const conversationState = useConversationState();
    const interactiveRunStore = useInteractiveRunStore();
    const conversationA = conversationState.createConversation({
      id: 'conversation-awaiting-a',
      title: '等待回答的会话',
      autoActivate: true,
    });
    const controller = new AbortController();
    interactiveRunStore.beginStart(conversationA, controller);
    interactiveRunStore.observeEvent({
      type: 'requires_user_interaction',
      id: 'wait-a',
      conversation_id: conversationA,
      turn_id: 'turn-a',
      run_id: RunIdSchema.parse('run-a'),
      execution_id: 'execution-a',
      lane: 'foreground',
      visibility: 'conversation',
      timestamp: 1,
      interaction_id: 'interaction-a',
      tool_call_id: ToolCallIdSchema.parse('tool-call-a'),
      checkpoint_revision: 2,
      resume_token: 'resume-a',
      interaction_status: 'pending',
      form: { fields: [] },
    });
    const cancelSpy = vi.spyOn(assistantStore, 'cancelCurrentStream');

    await loaderStore.loadConversation('conversation-b', {
      initialConversation: {
        title: '另一条会话',
        created_at: 2,
        last_event_at: 3,
        project_id: null,
      },
    });

    expect(cancelSpy).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(false);
    expect(interactiveRunStore.snapshotFor(conversationA)).toMatchObject({
      runId: 'run-a',
      status: 'awaiting_user',
      pendingInteraction: {
        interactionId: 'interaction-a',
        toolCallId: 'tool-call-a',
      },
    });
    expect(conversationState.activeConversationId).toBe('conversation-b');
  });

  it('回答流出后切走再切回时，后台 final seal 必须继续命中原 conversation projection', async () => {
    const loaderStore = useHistoryLoaderStore();
    const assistantStore = useAssistantStore();
    const conversationState = useConversationState();
    const conversationA = conversationState.createConversation({
      id: 'conversation-streaming-a',
      title: '后台生成中的会话',
      autoActivate: true,
    });
    const answerId = 'answer-background-switch';
    const executionScope = {
      run_id: 'run-background-switch',
      execution_id: 'execution-background-switch',
      lane: 'foreground' as const,
      visibility: 'conversation' as const,
    };

    await expect(
      assistantStore.handleSseEvent(conversationA, {
        type: 'final_answer_chunk',
        id: 'chunk-background-switch-0',
        conversation_id: conversationA,
        turn_id: 'turn-background-switch',
        timestamp: 10,
        answer_id: answerId,
        seq: 0,
        chunk: '切换期间完成的回答',
        is_last: true,
        ...executionScope,
      })
    ).resolves.toMatchObject({ success: true });

    await loaderStore.loadConversation('conversation-streaming-b', {
      initialConversation: {
        title: '另一条会话',
        created_at: 2,
        last_event_at: 3,
        project_id: null,
      },
    });

    const returningMetadata = createDeferredPromise<ConversationMetadata | null>();
    fetchMetadataMock.mockImplementationOnce(() => returningMetadata.promise);
    const loadingIntent = loaderStore.beginConversationLoadingIntent(conversationA, {
      initialConversation: buildMetadata(conversationA),
    });
    if (!loadingIntent) {
      throw new Error('returning conversation should create a loading intent');
    }
    const returningLoad = loaderStore.loadConversation(conversationA, {
      initialConversation: buildMetadata(conversationA),
      loadingIntent,
    });
    await Promise.resolve();

    await expect(
      assistantStore.handleSseEvent(conversationA, {
        type: 'final_answer',
        id: answerId,
        conversation_id: conversationA,
        turn_id: 'turn-background-switch',
        timestamp: 11,
        answer_id: answerId,
        content: '切换期间完成的回答',
        completion_reason: 'terminal',
        ...executionScope,
      })
    ).resolves.toMatchObject({
      success: true,
      reason: 'History window is loading; event buffered',
    });

    returningMetadata.resolve(buildMetadata(conversationA));
    await returningLoad;

    const restoredConversation = conversationState.conversations.find(
      item => item.id === conversationA
    );
    const answer = restoredConversation?.messages.find(
      message => message.type === 'final_answer' && message.metadata.answer_id === answerId
    );
    expect(answer).toMatchObject({
      role: 'assistant',
      type: 'final_answer',
      content: '切换期间完成的回答',
      metadata: {
        answer_id: answerId,
        is_complete: true,
        completion_reason: 'terminal',
      },
    });
    expect(loaderStore.error).toBeNull();
    expect(conversationState.activeConversationId).toBe(conversationA);
  });

  it('旧 navigation intent 迟到时直接退出，不创建新 token 干扰当前加载', async () => {
    const loaderStore = useHistoryLoaderStore();
    const firstIntent = loaderStore.beginConversationLoadingIntent('conversation-old', {
      initialConversation: {
        title: '旧会话',
        created_at: 1,
        last_event_at: 2,
        project_id: null,
      },
    });
    const latestIntent = loaderStore.beginConversationLoadingIntent('conversation-latest', {
      initialConversation: {
        title: '新会话',
        created_at: 3,
        last_event_at: 4,
        project_id: null,
      },
    });
    if (!firstIntent || !latestIntent) {
      throw new Error('loading intents should be created');
    }

    const staleResult = await loaderStore.loadConversation('conversation-old', {
      initialConversation: {
        title: '旧会话',
        created_at: 1,
        last_event_at: 2,
        project_id: null,
      },
      loadingIntent: firstIntent,
    });
    expect(staleResult).toEqual({
      status: 'stale',
      conversationId: 'conversation-old',
    });
    expect(fetchMetadataMock).not.toHaveBeenCalled();

    await loaderStore.loadConversation('conversation-latest', {
      initialConversation: {
        title: '新会话',
        created_at: 3,
        last_event_at: 4,
        project_id: null,
      },
      loadingIntent: latestIntent,
    });

    expect(fetchMetadataMock).toHaveBeenCalledTimes(1);
    expect(fetchMetadataMock).toHaveBeenCalledWith('conversation-latest');
  });

  it('旧加载被新会话打断时，应回滚自己写入的 loading 壳', async () => {
    const loaderStore = useHistoryLoaderStore();
    const conversationState = useConversationState();
    const oldConversationId = conversationState.createConversation({
      id: 'conversation-aborted-old',
      title: '旧会话原始标题',
      autoActivate: true,
    });
    const oldConversation = conversationState.conversations.find(
      conversation => conversation.id === oldConversationId
    );
    if (!oldConversation) {
      throw new Error('old conversation should exist');
    }
    oldConversation.messages = [buildUserMessage('old-user-1', '旧会话消息')];

    const metadataDeferred = createDeferredPromise<ConversationMetadata | null>();
    fetchMetadataMock.mockImplementationOnce(() => metadataDeferred.promise);

    const oldIntent = loaderStore.beginConversationLoadingIntent(oldConversationId, {
      initialConversation: {
        title: '旧会话列表标题',
        created_at: 1,
        last_event_at: 2,
        project_id: null,
      },
    });
    if (!oldIntent) {
      throw new Error('old loading intent should be created');
    }

    expect(
      conversationState.conversations.find(conversation => conversation.id === oldConversationId)
    ).toBeTruthy();
    expect(conversationState.historyLoadingConversationId).toBe(oldConversationId);

    const oldLoadPromise = loaderStore.loadConversation(oldConversationId, {
      initialConversation: {
        title: '旧会话列表标题',
        created_at: 1,
        last_event_at: 2,
        project_id: null,
      },
      loadingIntent: oldIntent,
    });
    await Promise.resolve();

    const latestIntent = loaderStore.beginConversationLoadingIntent(
      'conversation-latest-after-abort',
      {
        initialConversation: {
          title: '新会话',
          created_at: 3,
          last_event_at: 4,
          project_id: null,
        },
      }
    );
    if (!latestIntent) {
      throw new Error('latest loading intent should be created');
    }

    metadataDeferred.resolve(buildMetadata(oldConversationId));
    await oldLoadPromise;

    const restoredOldConversation = conversationState.conversations.find(
      conversation => conversation.id === oldConversationId
    );
    expect(restoredOldConversation?.title).toBe('旧会话原始标题');
    expect(restoredOldConversation?.messages.map(message => message.content)).toEqual([
      '旧会话消息',
    ]);
    expect(loaderStore.loadingConversationId).toBe('conversation-latest-after-abort');
    expect(conversationState.historyLoadingConversationId).toBe('conversation-latest-after-abort');
  });

  it('read model 仍在 preparing 时应明确清理本次缓冲', async () => {
    loadHistoryWindowTailMock.mockResolvedValueOnce('preparing');
    const loaderStore = useHistoryLoaderStore();
    const assistantStore = useAssistantStore();
    const discardBufferSpy = vi.spyOn(assistantStore, 'discardHistoryLoadingSseBuffer');
    const conversationId = 'conversation-preparing';

    await loaderStore.loadConversation(conversationId, {
      initialConversation: {
        title: '准备中的会话',
        created_at: 1,
        last_event_at: 2,
        project_id: null,
      },
    });

    expect(discardBufferSpy).toHaveBeenCalledWith(
      conversationId,
      expect.any(Number),
      'window-preparing'
    );
  });

  it('删除失效只清理 Loader 自身世代，并把跨 store 清理责任返回给编排层', () => {
    const loaderStore = useHistoryLoaderStore();
    const assistantStore = useAssistantStore();
    const conversationState = useConversationState();
    const conversationId = 'conversation-loader-invalidation-boundary';
    const loadingIntent = loaderStore.beginConversationLoadingIntent(conversationId, {
      initialConversation: {
        title: '待失效会话',
        created_at: 1,
        last_event_at: 2,
        project_id: null,
      },
    });
    if (!loadingIntent) {
      throw new Error('loading intent should be created');
    }
    const discardBufferSpy = vi.spyOn(assistantStore, 'discardHistoryLoadingSseBuffer');
    const clearHistoryLoadingSpy = vi.spyOn(conversationState, 'setHistoryLoadingConversation');

    const result = loaderStore.forgetConversation(conversationId);

    expect(result).toEqual({
      bufferRequestToken: loadingIntent.requestToken,
      ownsLoadingState: true,
    });
    expect(loaderStore.isLoading).toBe(false);
    expect(loaderStore.loadingConversationId).toBeNull();
    expect(discardBufferSpy).not.toHaveBeenCalled();
    expect(clearHistoryLoadingSpy).not.toHaveBeenCalled();
    expect(conversationState.historyLoadingConversationId).toBe(conversationId);
  });

  it('缓冲回放期间加载世代失效时应中止旧会话落地', async () => {
    const loaderStore = useHistoryLoaderStore();
    const assistantStore = useAssistantStore();
    const conversationState = useConversationState();
    const oldConversationId = 'conversation-replay-stale';
    vi.spyOn(assistantStore, 'replayBufferedHistoryLoadingEvents').mockImplementationOnce(
      async () => {
        const nextIntent = loaderStore.beginConversationLoadingIntent(
          'conversation-after-replay-stale',
          {
            initialConversation: {
              title: '新会话',
              created_at: 3,
              last_event_at: 4,
              project_id: null,
            },
          }
        );
        if (!nextIntent) {
          throw new Error('next loading intent should be created');
        }
        return 'stale';
      }
    );

    await loaderStore.loadConversation(oldConversationId, {
      initialConversation: {
        title: '旧会话',
        created_at: 1,
        last_event_at: 2,
        project_id: null,
      },
    });

    expect(loaderStore.loadingConversationId).toBe('conversation-after-replay-stale');
    expect(conversationState.historyLoadingConversationId).toBe('conversation-after-replay-stale');
    expect(
      conversationState.conversations.some(conversation => conversation.id === oldConversationId)
    ).toBe(false);
  });
});
