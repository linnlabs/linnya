import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useAssistantStore } from './assistantStore';
import { useConversationState } from './conversationState';
import {
  createTestAnswerMessage,
  createTestUserMessage,
} from '../testing/functions/createConversationTestMessage';

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn<typeof fetch>(),
}));

vi.mock('../../../shared/services/aiService/common', () => ({
  apiFetch: apiFetchMock,
  getApiBaseUrl: async () => 'http://conversation.test',
}));

vi.mock('../../../shared/stores/ui', () => ({
  useUIStore: () => ({}),
}));

vi.mock('../../../shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => ({
    currentScope: { kind: 'linnya-assistant' },
    currentProjectId: null,
    rememberLastActiveConversation: vi.fn(),
  }),
}));

vi.mock('../services/orchestration/toolingFlowOrchestrator', () => ({
  useToolingFlowOrchestrator: () => ({
    concludeAskQuestionsInteraction: vi.fn(),
  }),
}));

vi.mock('../services/orchestration/annotationRunOrchestrator', () => ({
  useAnnotationRunOrchestrator: () => ({
    executeAnnotationRun: vi.fn(),
    cancelAnnotationRun: vi.fn(),
  }),
}));

vi.mock('../services/orchestration/reconcileTerminalConversationView', () => ({
  reconcileTerminalConversationView: vi.fn(async () => undefined),
}));

vi.mock('../services/assistantService', () => ({}));

vi.mock('../history/store/historyLoaderStore', () => ({
  useHistoryLoaderStore: () => ({
    loadConversation: vi.fn(),
  }),
}));

type LocalStorageMock = {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
};

function baseMessages() {
  return [
    createTestUserMessage({ id: 'msg_user_1', content: '第一问', timestamp: 1 }),
    createTestAnswerMessage({ id: 'msg_answer_1', content: '第一答', timestamp: 2 }),
  ];
}

const firstExecutionScope = {
  run_id: 'run_stop_1',
  execution_id: 'execution_stop_1',
  lane: 'foreground' as const,
  visibility: 'conversation' as const,
};

const secondExecutionScope = {
  run_id: 'run_followup_2',
  execution_id: 'execution_followup_2',
  lane: 'foreground' as const,
  visibility: 'conversation' as const,
};

describe('assistantStore interrupted follow-up e2e regression', () => {
  let localStorageMock: LocalStorageMock;

  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());

    localStorageMock = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          run_id: firstExecutionScope.run_id,
          outcome: 'cancelled',
          terminal_status: 'cancelled',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stop 后立刻继续发送并开始下一轮时，应保留上一轮历史与中断前已输出内容', async () => {
    const assistantStore = useAssistantStore();
    const conversationState = useConversationState();

    const conversationId = conversationState.createConversation({
      id: 'conv_assistant_interrupted_followup',
      title: 'stop-continue',
      autoActivate: true,
    });
    const conversation = conversationState.conversations.find(item => item.id === conversationId);
    if (!conversation) {
      throw new Error('conversation should exist');
    }
    conversation.messages = baseMessages();

    const firstController = new AbortController();
    assistantStore.startInteractiveRun(firstController);

    await assistantStore.handleSseEvent(conversationId, {
      type: 'final_answer_chunk',
      id: 'evt_turn_1_chunk_1',
      conversation_id: conversationId,
      turn_id: 'turn_stop_1',
      timestamp: 3,
      answer_id: 'answer_stop_1',
      seq: 0,
      chunk: '中断前输出',
      ...firstExecutionScope,
    });

    expect(assistantStore.isStreaming).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    assistantStore.cancelCurrentStream();

    await vi.waitFor(() => {
      expect(firstController.signal.aborted).toBe(true);
    });
    expect(assistantStore.isStreaming).toBe(false);
    expect(assistantStore.isLoading).toBe(false);

    assistantStore.commitUserInput({
      type: 'user_input_committed',
      id: 'message_followup',
      timestamp: 4,
      conversation_id: conversationId,
      turn_id: 'turn_followup',
      operation: 'append',
      content: '继续追问',
      raw_content: '继续追问',
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(conversationState.conversations[0]?.messages.map(message => message.content)).toEqual([
      '第一问',
      '第一答',
      '中断前输出',
      '继续追问',
    ]);

    const secondController = new AbortController();
    assistantStore.startInteractiveRun(secondController);

    await assistantStore.handleSseEvent(conversationId, {
      type: 'final_answer_chunk',
      id: 'evt_turn_2_chunk_1',
      conversation_id: conversationId,
      turn_id: 'turn_followup_2',
      timestamp: 4,
      answer_id: 'answer_followup_2',
      seq: 0,
      chunk: '第二轮输出',
      ...secondExecutionScope,
    });

    await vi.advanceTimersByTimeAsync(60);

    expect(conversationState.conversations[0]?.messages.map(message => message.content)).toEqual([
      '第一问',
      '第一答',
      '中断前输出',
      '继续追问',
      '第二轮输出',
    ]);
  });
});
