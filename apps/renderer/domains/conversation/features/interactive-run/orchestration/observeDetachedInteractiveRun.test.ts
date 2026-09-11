import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  fetchForegroundRunSettlement,
  fetchActiveForegroundRun,
  requestForegroundRunPause,
} from './interactiveRunApi';
import { observeDetachedInteractiveRun } from './observeDetachedInteractiveRun';
import { pauseInteractiveRun } from './pauseInteractiveRun';
import { useInteractiveRunStore } from '../store/interactiveRunStore';
import { reconcileTerminalConversationView } from '../../../services/orchestration/reconcileTerminalConversationView';

vi.mock('./interactiveRunApi', () => ({
  fetchForegroundRunSettlement: vi.fn(),
  fetchActiveForegroundRun: vi.fn(),
  requestForegroundRunPause: vi.fn(),
}));
vi.mock('../../../services/orchestration/reconcileTerminalConversationView', () => ({
  reconcileTerminalConversationView: vi.fn(),
}));

describe('脱离 SSE 的运行观察', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
  });
  const original = {
    conversationId: 'conversation-1',
    runId: 'run-1',
    executionId: 'old',
    status: 'running' as const,
  };

  it.each([false, true])(
    'Backend 暂时不可达保持重连，再恢复暂停凭证；暂停命令断网=%s',
    async pauseCommandFailure => {
      const store = useInteractiveRunStore();
      store.synchronizeSnapshot('conversation-1', original);
      if (pauseCommandFailure) {
        vi.mocked(requestForegroundRunPause).mockRejectedValueOnce(new Error('offline'));
        vi.mocked(fetchActiveForegroundRun).mockRejectedValueOnce(new Error('offline'));
        await expect(pauseInteractiveRun('conversation-1')).rejects.toThrow('offline');
      } else {
        vi.mocked(fetchForegroundRunSettlement).mockRejectedValueOnce(new Error('offline'));
        await observeDetachedInteractiveRun('conversation-1');
      }
      expect(store.snapshotFor('conversation-1')).toMatchObject({
        status: 'reconnecting',
        runId: 'run-1',
      });
      vi.mocked(fetchForegroundRunSettlement).mockResolvedValue({
        conversation_id: 'conversation-1',
        requested_run_id: 'run-1',
        run: {
          run_id: 'run-1',
          turn_id: 'turn-1',
          execution_id: 'old',
          status: 'paused',
          lane: 'foreground',
          pause: { settled: true, updated_at: 20 },
        },
      });
      await observeDetachedInteractiveRun('conversation-1');
      expect(store.snapshotFor('conversation-1')).toMatchObject({
        status: 'paused',
        pause: { settled: true, updatedAt: 20 },
      });
      expect(reconcileTerminalConversationView).toHaveBeenCalledOnce();
    }
  );

  it('迟到查询不能覆盖正在继续的新 execution', async () => {
    const store = useInteractiveRunStore();
    store.synchronizeSnapshot('conversation-1', original);
    let rejectQuery!: (error: Error) => void;
    vi.mocked(fetchForegroundRunSettlement).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectQuery = reject;
      })
    );
    const observation = observeDetachedInteractiveRun('conversation-1');
    store.beginContinuation(
      { ...original, status: 'paused', pause: { settled: true, updatedAt: 20 } },
      new AbortController()
    );
    rejectQuery(new Error('old failure'));
    await observation;
    expect(store.snapshotFor('conversation-1')).toMatchObject({ status: 'continuing' });
    expect(reconcileTerminalConversationView).not.toHaveBeenCalled();
  });
});
