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
import { ConversationUiMessageSchema, conversationMessageIdFromClientNoticeId } from '@app/schemas';
import { mapUiMessageDtoToWindowRow } from '../message-window/functions/mapUiMessageDto';
import { projectConversationVisualRows } from '../ui/conversationView/logic/projectConversationVisualRows';
import { localClientNoticeMessages } from '../features/client-notices/functions/clientNoticePresentation';

vi.mock('@/app/navigation', () => ({
  useNavigationScope: () => ({
    currentScope: { kind: 'linnya-assistant' },
    currentProjectId: null,
    rememberLastActiveConversation: vi.fn(),
  }),
}));

vi.mock('@/app/navigation', () => ({
  useNavigationScope: () => ({
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

  it('旧加载故障保留内部行和游标，但不再显示为正文或使空对话进入 populated 状态', () => {
    activateConversation();
    const noticeId = '3bc05782-a8f4-400b-8a87-ded268962652';
    const command = {
      notice_id: noticeId, observed_at: 10, operation: 'load', error_kind: 'unknown',
    } as const;
    const dto = ConversationUiMessageSchema.parse({
      message_id: conversationMessageIdFromClientNoticeId(noticeId), conversation_id: 'conv-window-phase',
      turn_id: null, run_id: null, role: 'system', message_type: 'client_notice', timestamp: 10, sort_seq: 1,
      content: null, merge_key: null, presentation: null, payload: { ...command, origin: 'client' },
    });
    const windowStore = useMessageWindowStore();
    windowStore.replaceWithSnapshot({
      conversationId: 'conv-window-phase', rows: [mapUiMessageDtoToWindowRow(dto, 1)],
      latestContextUsage: null, revision: 1, hasMoreBefore: true, hasMoreAfter: false, prevCursor: 1,
    });
    expect(windowStore.rows).toHaveLength(1);
    expect(windowStore.prevCursor).toBe(1);
    expect(useConversationContentPhaseSelector().value).toBe('ready-empty');
    const messages = windowStore.rows.map(row => row.message);
    expect(projectConversationVisualRows(messages)).toHaveLength(0);
    expect(projectConversationVisualRows([...messages, createMessage()])).toHaveLength(1);
    expect(localClientNoticeMessages([{
      command, conversationId: 'conv-window-phase', draftKey: 'draft', acceptedAt: null,
    }], 'conv-window-phase', 'draft', [])).toHaveLength(0);
  });

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
        latestContextUsage: null,
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
      latestContextUsage: null,
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
      latestContextUsage: null,
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
