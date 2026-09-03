import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAnnotationRunExecutionStore } from '../features/annotation-run/store/annotationRunExecutionStore';
import { useInteractiveRunStore } from '../features/interactive-run';
import { useAssistantStore } from './assistantStore';
import { useConversationState } from './conversationState';
import { useExecutionState } from './executionState';

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

vi.mock('../services/assistantService', () => ({}));

vi.mock('../history/store/historyLoaderStore', () => ({
  useHistoryLoaderStore: () => ({
    loadConversation: vi.fn(),
  }),
}));

describe('assistantStore error dismissal', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('关闭当前横幅会清理它的真实 owner，同时保留后台会话错误', () => {
    const conversationState = useConversationState();
    conversationState.createConversation({ id: 'conversation-active', autoActivate: true });
    conversationState.createConversation({ id: 'conversation-background' });

    const assistantStore = useAssistantStore();
    const interactiveRunStore = useInteractiveRunStore();
    const executionState = useExecutionState();
    const annotationRunStore = useAnnotationRunExecutionStore();

    interactiveRunStore.failRun('conversation-active', '当前会话 Provider 失败');
    interactiveRunStore.failRun('conversation-background', '后台会话 Provider 失败');
    executionState.setError('旧执行链错误');
    const annotationController = new AbortController();
    annotationRunStore.begin({
      conversationId: 'conversation-active',
      runId: 'annotation-run',
      controller: annotationController,
    });
    annotationRunStore.settle({
      controller: annotationController,
      errorMessage: '当前会话批注错误',
    });

    expect(assistantStore.error).toBe('当前会话 Provider 失败');

    assistantStore.clearError();

    expect(assistantStore.error).toBeNull();
    expect(interactiveRunStore.snapshotFor('conversation-active')?.error).toBeUndefined();
    expect(executionState.error).toBeNull();
    expect(annotationRunStore.errorFor('conversation-active')).toBeNull();

    conversationState.setActiveConversation('conversation-background');
    expect(assistantStore.error).toBe('后台会话 Provider 失败');
  });

  it('Runtime 429 通过统一投影写入当前会话 ErrorBanner 状态', async () => {
    const conversationState = useConversationState();
    conversationState.createConversation({ id: 'conversation-429', autoActivate: true });
    const assistantStore = useAssistantStore();

    const result = await assistantStore.handleSseEvent('conversation-429', {
      type: 'error',
      id: 'event-provider-429',
      timestamp: 1,
      conversation_id: 'conversation-429',
      turn_id: 'turn-provider-429',
      run_id: 'run-provider-429',
      execution_id: 'execution-provider-429',
      lane: 'foreground',
      visibility: 'conversation',
      error: 'Canonical inference failed: provider_http_429',
      error_code: 'llm.provider_http_429',
      retryable: true,
    });

    expect(result.success).toBe(true);
    expect(assistantStore.error).toBe(
      '模型服务返回 429，可能是额度已用尽或请求过于频繁。请稍后重试，或切换模型。',
    );
  });
});
