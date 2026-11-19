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
import { refreshDetachedConversationView } from '../../../services/orchestration/refreshDetachedConversationView';

vi.mock('./interactiveRunApi', () => ({
  fetchForegroundRunSettlement: vi.fn(),
  fetchActiveForegroundRun: vi.fn(),
  requestForegroundRunPause: vi.fn(),
}));
vi.mock('../../../services/orchestration/refreshDetachedConversationView', () => ({
  refreshDetachedConversationView: vi.fn(),
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
      expect(refreshDetachedConversationView).toHaveBeenCalledOnce();
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
    expect(refreshDetachedConversationView).not.toHaveBeenCalled();
  });

  it('空闲时窗口 revision 未变不再查询运行；窗口出现新内容时接入其它入口启动的在途运行', async () => {
    const store = useInteractiveRunStore();
    vi.mocked(refreshDetachedConversationView).mockResolvedValueOnce('unchanged');
    await observeDetachedInteractiveRun('conversation-1');
    expect(fetchActiveForegroundRun).not.toHaveBeenCalled();
    expect(store.snapshotFor('conversation-1')).toBeUndefined();

    vi.mocked(refreshDetachedConversationView).mockResolvedValueOnce('updated');
    vi.mocked(fetchActiveForegroundRun).mockResolvedValueOnce({
      conversation_id: 'conversation-1',
      run: {
        run_id: 'run-cli',
        turn_id: 'turn-cli',
        execution_id: 'exec-cli',
        status: 'running',
        lane: 'foreground',
      },
    });
    await observeDetachedInteractiveRun('conversation-1');
    expect(store.snapshotFor('conversation-1')).toMatchObject({ status: 'running', runId: 'run-cli' });
  });

  it('本窗口的运行结束后，CLI 工具调用这类已结束的外部运行只刷新窗口，不改控制状态', async () => {
    const store = useInteractiveRunStore();
    const finished = { ...original, status: 'completed' as const };
    store.synchronizeSnapshot('conversation-1', finished);
    vi.mocked(refreshDetachedConversationView).mockResolvedValueOnce('updated');
    vi.mocked(fetchActiveForegroundRun).mockResolvedValueOnce({ conversation_id: 'conversation-1', run: null });
    await observeDetachedInteractiveRun('conversation-1');
    expect(refreshDetachedConversationView).toHaveBeenCalledOnce();
    expect(store.snapshotFor('conversation-1')).toEqual(finished);

    vi.mocked(refreshDetachedConversationView).mockRejectedValueOnce(new Error('offline'));
    await observeDetachedInteractiveRun('conversation-1');
    expect(store.snapshotFor('conversation-1')).toEqual(finished);
  });

  it('本窗口持有 reader 时不观察', async () => {
    const store = useInteractiveRunStore();
    store.beginStart('conversation-1', new AbortController());
    await observeDetachedInteractiveRun('conversation-1');
    expect(refreshDetachedConversationView).not.toHaveBeenCalled();
    expect(fetchActiveForegroundRun).not.toHaveBeenCalled();
  });
});
