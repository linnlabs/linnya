import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAnnotationRunExecutionStore } from './annotationRunExecutionStore';

describe('annotationRunExecutionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('迟到的旧 run 回调不能清理新 run 的执行态', () => {
    const store = useAnnotationRunExecutionStore();
    const first = new AbortController();
    const second = new AbortController();

    store.begin({ conversationId: 'conversation-1', runId: 'run-1', controller: first });
    store.begin({ conversationId: 'conversation-2', runId: 'run-2', controller: second });
    store.settle({ controller: first, errorMessage: 'old failure' });

    expect(store.currentAbortController).toBe(second);
    expect(store.isLoading).toBe(true);
    expect(store.isStreaming).toBe(true);
    expect(store.error).toBeNull();
    expect(store.isStreamingFor('conversation-1')).toBe(false);
    expect(store.isStreamingFor('conversation-2')).toBe(true);

    store.settle({ controller: second, errorMessage: null });
    expect(store.currentAbortController).toBeNull();
    expect(store.isLoading).toBe(false);
    expect(store.isStreaming).toBe(false);
  });
});
