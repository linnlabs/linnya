import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { useAssistantStore } from './assistantStore';
import { useConversationContentPhaseSelector } from './conversationContentPhaseSelector';
import { useConversationState } from './conversationState';
import { useMessageWindowStore } from '../message-window/store/messageWindowStore';
import type { WindowMessageRow } from '../message-window/definitions/messageWindow';
import type { BaseMessage } from '../types';
import { createTestAnswerMessage } from '../testing/functions/createConversationTestMessage';

vi.mock('@/shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => ({
    currentScope: { kind: 'linnya-assistant' },
    currentProjectId: null,
    rememberLastActiveConversation: vi.fn(),
  }),
}));

vi.mock('../../../shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => ({
    currentScope: { kind: 'linnya-assistant' },
    currentProjectId: null,
    rememberLastActiveConversation: vi.fn(),
  }),
}));

vi.mock('../../../shared/stores/ui', () => ({
  useUIStore: () => ({}),
}));

vi.mock('../services/orchestration/toolingFlowOrchestrator', () => ({
  useToolingFlowOrchestrator: () => ({
    concludeAskQuestionsInteraction: vi.fn(),
    concludeInteractiveToolInteraction: vi.fn(),
  }),
}));

vi.mock('../services/orchestration/annotationRunOrchestrator', () => ({
  useAnnotationRunOrchestrator: () => ({
    executeAnnotationRun: vi.fn(),
    cancelAnnotationRun: vi.fn(),
  }),
}));

vi.mock('../services/assistantService', () => ({
}));

vi.mock('../history/store/historyLoaderStore', () => ({
  useHistoryLoaderStore: () => ({
    loadConversation: vi.fn(),
  }),
}));

function createMessage(): BaseMessage {
  return createTestAnswerMessage({ id: 'window-message', content: '历史窗口消息', timestamp: 1 });
}

function createWindowRow(): WindowMessageRow {
  return {
    conversationId: 'conv-window-phase',
    messageId: 'window-message',
    sortSeq: 1,
    revision: 1,
    dto: {
      conversation_id: 'conv-window-phase',
      message_id: 'window-message',
      turn_id: 'turn-window-message',
      role: 'assistant',
      message_type: 'final_answer',
      sort_seq: 1,
      timestamp: 1,
      content: '历史窗口消息',
      payload: {
        answer_id: 'window-message',
        is_complete: true,
        completion_reason: 'terminal',
        first_token_at: 1,
      },
      merge_key: null,
      presentation: null,
      run_id: 'run-window',
    },
    message: createMessage(),
  };
}

describe('useConversationContentPhaseSelector', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function activateConversation(): void {
    const conversationState = useConversationState();
    conversationState.createConversation({
      id: 'conv-window-phase',
      title: 'Window phase',
      autoActivate: true,
    });
  }

  it.each(['before', 'after'] as const)(
    '%s 背景分页期间保留 ready 相位，不整窗切到历史加载态',
    async (loadingMode) => {
      const assistantStore = useAssistantStore();
      const windowStore = useMessageWindowStore();
      const phase = useConversationContentPhaseSelector();

      activateConversation();
      assistantStore.setSelectedConversation('conv-window-phase');
      windowStore.replaceWithSnapshot({
        conversationId: 'conv-window-phase',
        rows: [createWindowRow()],
        hasMoreBefore: true,
        hasMoreAfter: false,
        prevCursor: 1,
        revision: 1,
      });
      windowStore.startLoading('conv-window-phase', loadingMode);
      await nextTick();

      expect(windowStore.isBackgroundPaging).toBe(true);
      expect(phase.value).toBe('ready');
    },
  );

  it('tail 初始窗口加载期间仍显示 history-loading', async () => {
    const assistantStore = useAssistantStore();
    const windowStore = useMessageWindowStore();
    const phase = useConversationContentPhaseSelector();

    activateConversation();
    assistantStore.setSelectedConversation('conv-window-phase');
    windowStore.replaceWithSnapshot({
      conversationId: 'conv-window-phase',
      rows: [createWindowRow()],
      hasMoreBefore: true,
      hasMoreAfter: false,
      prevCursor: 1,
      revision: 1,
    });
    windowStore.startLoading('conv-window-phase', 'tail');
    await nextTick();

    expect(windowStore.isInitialWindowLoading).toBe(true);
    expect(phase.value).toBe('history-loading');
  });

  it('around 导航换窗期间保留 ready 相位和现有画布', async () => {
    const assistantStore = useAssistantStore();
    const windowStore = useMessageWindowStore();
    const phase = useConversationContentPhaseSelector();

    activateConversation();
    assistantStore.setSelectedConversation('conv-window-phase');
    windowStore.replaceWithSnapshot({
      conversationId: 'conv-window-phase',
      rows: [createWindowRow()],
      hasMoreBefore: true,
      hasMoreAfter: false,
      prevCursor: 1,
      revision: 1,
    });
    windowStore.startLoading('conv-window-phase', 'around');
    await nextTick();

    expect(windowStore.isInitialWindowLoading).toBe(false);
    expect(windowStore.isNavigationLoading).toBe(true);
    expect(phase.value).toBe('ready');
  });

  it('projection preparing 期间维持 history-loading', async () => {
    const assistantStore = useAssistantStore();
    const windowStore = useMessageWindowStore();
    const phase = useConversationContentPhaseSelector();

    activateConversation();
    assistantStore.setSelectedConversation('conv-window-phase');
    windowStore.setPreparing('conv-window-phase');
    await nextTick();

    expect(windowStore.isPreparing).toBe(true);
    expect(phase.value).toBe('history-loading');
  });
});
