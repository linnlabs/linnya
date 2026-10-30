import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAnnotationRunExecutionStore } from '../features/annotation-run/store/annotationRunExecutionStore';
import { useInteractiveRunStore } from '../features/interactive-run';
import { useAssistantStore } from './assistantStore';
import { useConversationState } from './conversationState';
import { useExecutionState } from './executionState';
import { reconcileInteractiveRunTransportOutcome } from '../features/interactive-run/orchestration/reconcileInteractiveRunTransportOutcome';
import { fetchForegroundRunSettlement, fetchActiveForegroundRun } from '../features/interactive-run/orchestration/interactiveRunApi';
import { restoreInteractiveRun } from '../features/interactive-run/orchestration/restoreInteractiveRun';

vi.mock('../features/interactive-run/orchestration/interactiveRunApi', () => ({
  fetchForegroundRunSettlement: vi.fn(),
  fetchActiveForegroundRun: vi.fn(),
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

    // 关闭只清理当前横幅的 interactive owner；其它来源继续保留并按优先级显现。
    expect(assistantStore.error).toBe('旧执行链错误');
    expect(interactiveRunStore.snapshotFor('conversation-active')?.error).toBeUndefined();
    expect(executionState.error).toBe('旧执行链错误');
    expect(annotationRunStore.errorFor('conversation-active')).toBe('当前会话批注错误');

    assistantStore.clearError();
    expect(assistantStore.error).toBe('当前会话批注错误');
    expect(executionState.error).toBeNull();
    assistantStore.clearError();
    expect(assistantStore.error).toBeNull();
    expect(annotationRunStore.errorFor('conversation-active')).toBeNull();

    conversationState.setActiveConversation('conversation-background');
    expect(assistantStore.error).toBe('后台会话 Provider 失败');
  });

  it('Runtime 429 通过统一投影写入当前会话错误诊断状态', async () => {
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
      '模型额度不足或请求过于频繁，请检查额度或稍后重试。',
    );
  });

  it('401 错误经历暂停、transport 收尾和切回会话后仍可见，关闭后不复活，重试独立报错', async () => {
    const conversationState = useConversationState();
    conversationState.createConversation({ id: 'conversation-401', autoActivate: true });
    conversationState.createConversation({ id: 'conversation-other' });
    const assistant = useAssistantStore();
    const store = useInteractiveRunStore();
    const controller = new AbortController();
    store.beginStart('conversation-401', controller);
    const scope = {
      conversation_id: 'conversation-401', turn_id: 'turn-401',
      run_id: 'run-401', execution_id: 'execution-401',
      lane: 'foreground', visibility: 'conversation', timestamp: 1,
    } as const;
    const sendError = () => assistant.handleSseEvent('conversation-401', {
      ...scope, type: 'error', id: 'event-401',
      error: 'Canonical inference failed: provider_http_401',
      error_code: 'llm.provider_http_401', retryable: false,
    });
    await assistant.handleSseEvent('conversation-401', {
      ...scope, type: 'run_status', id: 'running-401', status: 'running',
    });
    await sendError();
    const visibleError = assistant.error;
    expect(visibleError).toBeTruthy();
    expect(visibleError).not.toContain('Canonical inference');
    // 错误不代表逻辑 run 已失败；Host 随后会在可恢复边界暂停。
    expect(store.snapshotFor('conversation-401')?.status).toBe('running');
    await assistant.handleSseEvent('conversation-401', {
      ...scope, type: 'run_status', id: 'paused-401', status: 'paused',
    });
    expect(assistant.error).toBe(visibleError);
    await assistant.handleSseEvent('conversation-401', {
      ...scope, type: 'transport_end', id: 'end-401', reason: 'complete',
    });
    const run = {
      run_id: scope.run_id, turn_id: scope.turn_id, execution_id: scope.execution_id,
      lane: 'foreground', status: 'paused',
      pause: { settled: true, updated_at: 4, reason: 'execution_interrupted' },
    } as const;
    vi.mocked(fetchForegroundRunSettlement).mockResolvedValue({
      conversation_id: scope.conversation_id, requested_run_id: scope.run_id, run,
    });
    await reconcileInteractiveRunTransportOutcome(scope.conversation_id, controller, { kind: 'interrupted' });
    expect(assistant.error).toBe(visibleError);
    expect(store.snapshotFor(scope.conversation_id)?.pause?.settled).toBe(true);
    conversationState.setActiveConversation('conversation-other');
    expect(assistant.error).toBeNull();
    conversationState.setActiveConversation(scope.conversation_id);
    vi.mocked(fetchActiveForegroundRun).mockResolvedValue({ conversation_id: scope.conversation_id, run });
    await restoreInteractiveRun(scope.conversation_id);
    expect(assistant.error).toBe(visibleError);
    assistant.clearError();
    await restoreInteractiveRun(scope.conversation_id);
    expect(assistant.error).toBeNull();
    const paused = store.snapshotFor(scope.conversation_id);
    if (!paused) throw new Error('Missing paused run');
    store.beginContinuation(paused, new AbortController());
    // 旧 reader 的迟到错误不得污染新一次恢复。
    await sendError();
    expect(assistant.error).toBeNull();
    await assistant.handleSseEvent(scope.conversation_id, {
      ...scope, execution_id: 'execution-retry', type: 'error', id: 'retry-401',
      error: 'Canonical inference failed: provider_http_401',
      error_code: 'llm.provider_http_401', retryable: false,
    });
    expect(assistant.error).toBe(visibleError);
  });

});
