// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, ref, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { CONVERSATION_RENDER_SCOPE_KEY } from '../../definitions/conversationRenderScope';
import { useInteractiveRunStore } from '../../features/interactive-run';
import { ConversationExecutionNoticeMetadataSchema } from '@app/schemas';
import { resolveCurrentConversationMessage } from '../../functions/resolveCurrentConversationMessage';
import type { ExecutionNoticeMessage as Notice } from '../../features/error-surface/definitions/executionNotice';
import ExecutionNoticeMessage from './ExecutionNoticeMessage.vue';

vi.mock('../useConversationLocalization', () => ({
  useConversationLocalization: () => ({ conversationMessage: resolveCurrentConversationMessage }),
}));
let app: ReturnType<typeof createApp> | undefined;
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = '';
  vi.useRealTimers();
});
function notice(status: 'waiting' | 'succeeded' | 'exhausted'): Notice {
  return {
    id: 'retry:run:episode',
    type: 'execution_notice',
    role: 'system',
    content: '',
    timestamp: 1000,
    metadata: ConversationExecutionNoticeMetadataSchema.parse({
      turn_id: 'turn',
      run_id: 'run',
      execution_id: 'execution',
      error_code: 'llm.network_error',
      retry: {
        retry_id: 'episode',
        category: 'transport',
        status,
        attempt: status === 'exhausted' ? 6 : 1,
        max_retries: 6,
        total_attempts: 2,
        started_at: 1000,
        updated_at: status === 'waiting' ? 1000 : 5000,
        ...(status === 'waiting' ? { next_retry_at: 2500 } : {}),
      },
    }),
  };
}
describe('ExecutionNoticeMessage lifecycle', () => {
  it('ticks during retry, retains the recovered text and stops its clock', async () => {
    setActivePinia(createPinia());
    const control = useInteractiveRunStore();
    control.synchronizeSnapshot('conversation', {
      conversationId: 'conversation',
      runId: 'run',
      executionId: 'execution',
      status: 'running',
    });
    vi.useFakeTimers();
    vi.setSystemTime(2000);
    const message = ref(notice('waiting'));
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    app = createApp({ setup: () => () => h(ExecutionNoticeMessage, { message: message.value }) });
    app.provide(CONVERSATION_RENDER_SCOPE_KEY, { conversationId: 'conversation' });
    app.mount(mount);
    expect(mount.textContent).toContain('(1/6)');
    expect(mount.textContent).toContain('已用 1 秒');
    await vi.advanceTimersByTimeAsync(1000);
    await nextTick();
    expect(mount.textContent).toContain('已用 2 秒');
    control.synchronizeSnapshot('conversation', {
      conversationId: 'conversation',
      runId: 'run',
      executionId: 'execution',
      status: 'paused',
      pause: { settled: true, updatedAt: 3000 },
    });
    await nextTick();
    expect(mount.querySelector('.execution-progress-text--shimmer')).toBeNull();
    expect(mount.textContent).toContain('上次重试结果未确认');
    control.synchronizeSnapshot('conversation', {
      conversationId: 'conversation',
      runId: 'run',
      executionId: 'resumed-execution',
      status: 'running',
    });
    await nextTick();
    expect(mount.querySelector('.execution-progress-text--shimmer')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    message.value = notice('succeeded');
    await nextTick();
    expect(mount.querySelector('.execution-progress-text--shimmer')).toBeNull();
    expect(mount.textContent).toContain('已用 4 秒');
    await vi.advanceTimersByTimeAsync(100000);
    await nextTick();
    expect(mount.textContent).toContain('已用 4 秒');
    expect(vi.getTimerCount()).toBe(0);
    message.value = notice('exhausted');
    await nextTick();
    expect(mount.textContent).toContain('(6/6)');
    expect(mount.querySelector('.execution-notice--failed')).not.toBeNull();
    expect(mount.querySelector('.execution-progress-text--shimmer')).toBeNull();
  });
});
