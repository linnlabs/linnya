import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '../../types';

const harness = vi.hoisted(() => {
  const conversation: Conversation = {
    id: 'conversation-annotation',
    title: '任务会话',
    titleOrigin: 'explicit',
    messages: [],
    selectedAgentId: null,
    createdAt: 1,
    updatedAt: 1,
  };

  return {
    conversation,
    invokeAssistant: vi.fn(),
    ensureMaterializedConversation: vi.fn(() => conversation),
    scheduleHistorySync: vi.fn(),
    annotationExecutionState: {
      setError: vi.fn(),
      begin: vi.fn(),
      settle: vi.fn(),
      currentAbortController: null,
    },
    assistantStore: {
      activeConversation: conversation,
      activeMessages: conversation.messages,
      commitUserInput: vi.fn((event: {
        id: string;
        content: string;
        timestamp: number;
      }) => {
        const message = {
          id: event.id,
          role: 'user' as const,
          type: 'user_input' as const,
          content: event.content,
          timestamp: event.timestamp,
        };
        conversation.messages.push(message);
        return message;
      }),
      handleSseEvent: vi.fn(),
      setError: vi.fn(),
      setSelectedConversation: vi.fn(),
    },
    conversationTitleFeature: {
      handleUserMessage: vi.fn(async () => undefined),
      discardConversation: vi.fn(),
    },
  };
});

vi.mock('../assistantService', () => ({
  invokeAssistant: harness.invokeAssistant,
}));

vi.mock('../../store/assistantStore', () => ({
  useAssistantStore: () => harness.assistantStore,
}));

vi.mock('../../features/annotation-run/store/annotationRunExecutionStore', () => ({
  useAnnotationRunExecutionStore: () => harness.annotationExecutionState,
}));

vi.mock('../../../../shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => ({
    currentProjectId: 'project-1',
    currentScope: { kind: 'project', projectId: 'project-1' },
  }),
}));

vi.mock('../../history/orchestration/scheduleSyncConversationToHistory', () => ({
  scheduleSyncConversationToHistory: harness.scheduleHistorySync,
}));

vi.mock('./helpers', () => ({
  useWorkspaceMetadata: () => ({
    buildWorkspaceMetadata: () => ({
      projectId: 'project-1',
      projectMetadata: { id: 'project-1' },
    }),
  }),
}));

vi.mock('./helpers/requestSaveBeforeAssistantInvoke', () => ({
  requestSaveBeforeAssistantInvoke: vi.fn(),
}));

vi.mock('./ensureMaterializedConversation', () => ({
  ensureMaterializedConversation: harness.ensureMaterializedConversation,
  hasRenderableConversationContent: () => false,
}));

vi.mock('../../functions/resolveCurrentConversationMessage', () => ({
  resolveCurrentConversationMessage: (key: string) => key,
}));

vi.mock('../../features/conversation-title', () => ({
  useConversationTitleFeature: () => harness.conversationTitleFeature,
}));

import { useAnnotationRunOrchestrator } from './annotationRunOrchestrator';

describe('annotationRunOrchestrator user input admission', () => {
  beforeEach(() => {
    harness.conversation.messages.splice(0);
    vi.clearAllMocks();
  });

  it('持久化 run 在 Host ack 前不创建消息，ack 后才提交标题与历史入口', async () => {
    harness.invokeAssistant.mockImplementation(async (params, callbacks) => {
      expect(harness.conversation.messages).toHaveLength(0);
      const messageId = params.options?.messageId;
      if (!messageId) throw new Error('messageId should be allocated');
      await callbacks.onUserInputCommitted?.({
        type: 'user_input_committed',
        id: messageId,
        timestamp: 2,
        conversation_id: 'conversation-annotation',
        turn_id: 'turn-annotation',
        operation: 'append',
        content: '润色当前段落',
        raw_content: '润色当前段落',
      });
      await callbacks.onTransportEnd?.();
    });

    await useAnnotationRunOrchestrator().executeAnnotationRun({
      prompt: '润色当前段落',
      mode: 'agent',
      options: {},
      streamHandlers: {
        onStreamChunk: vi.fn(),
        onTransportEnd: vi.fn(),
        onError: vi.fn(),
      },
    });

    expect(harness.assistantStore.commitUserInput).toHaveBeenCalledOnce();
    expect(harness.conversation.messages).toMatchObject([{ content: '润色当前段落' }]);
    expect(harness.conversationTitleFeature.handleUserMessage).toHaveBeenCalledOnce();
    expect(harness.scheduleHistorySync).toHaveBeenCalledOnce();
  });

  it('纯编辑器 run 明确 persist=false，且不物化、不投影 Conversation', async () => {
    harness.invokeAssistant.mockImplementation(async (params, callbacks) => {
      expect(params.options?.persist).toBe(false);
      expect(params.options?.messageId).toBeUndefined();
      expect(params.eventDispatcher).toBeUndefined();
      await callbacks.onTransportEnd?.();
    });

    await useAnnotationRunOrchestrator().executeAnnotationRun({
      prompt: '仅写回编辑器',
      mode: 'agent',
      options: {},
      persistToConversation: false,
      streamHandlers: {
        onStreamChunk: vi.fn(),
        onTransportEnd: vi.fn(),
        onError: vi.fn(),
      },
    });

    expect(harness.ensureMaterializedConversation).not.toHaveBeenCalled();
    expect(harness.assistantStore.commitUserInput).not.toHaveBeenCalled();
    expect(harness.scheduleHistorySync).not.toHaveBeenCalled();
  });
});
