import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { fetchForegroundRunSettlement } from './interactiveRunApi';
import { useInteractiveRunStore } from '../store/interactiveRunStore';
import { reconcileInteractiveRunTransportOutcome } from './reconcileInteractiveRunTransportOutcome';

vi.mock('./interactiveRunApi', () => ({
  fetchForegroundRunSettlement: vi.fn(),
}));

const fetchSettlementMock = vi.mocked(fetchForegroundRunSettlement);

describe('reconcileInteractiveRunTransportOutcome', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fetchSettlementMock.mockReset();
  });

  it('projection failure 后按 runId 同步 Host terminal，并保留两类错误上下文', async () => {
    const store = useInteractiveRunStore();
    const controller = new AbortController();
    store.beginStart('conversation-1', controller);
    store.synchronizeSnapshot('conversation-1', {
      conversationId: 'conversation-1',
      runId: 'run-1',
      turnId: 'turn-1',
      executionId: 'execution-1',
      status: 'running',
    });
    fetchSettlementMock.mockResolvedValue({
      conversation_id: 'conversation-1',
      requested_run_id: 'run-1',
      run: {
        run_id: 'run-1',
        status: 'cancelled',
        lane: 'foreground',
        error: {
          error_code: 'RUN_CANCELLED',
          message: 'client_disconnected',
          recoverable: false,
        },
      },
    });

    await reconcileInteractiveRunTransportOutcome('conversation-1', controller, {
      kind: 'failed',
      failure: {
        source: 'client',
        kind: 'projection',
        error: new Error('thought projection rejected'),
      },
    });

    expect(fetchSettlementMock).toHaveBeenCalledWith('conversation-1', 'run-1');
    expect(store.snapshotFor('conversation-1')).toMatchObject({
      status: 'cancelled',
      error: 'thought projection rejected; run settlement: client_disconnected',
    });
  });

  it('command 未接纳时恢复原 awaiting-user interaction 并退出 submitting', async () => {
    const store = useInteractiveRunStore();
    const controller = new AbortController();
    store.beginStart('conversation-1', controller);
    store.synchronizeSnapshot('conversation-1', {
      conversationId: 'conversation-1',
      runId: 'run-1',
      turnId: 'turn-1',
      executionId: 'execution-submit',
      status: 'submitting',
    });
    fetchSettlementMock.mockResolvedValue({
      conversation_id: 'conversation-1',
      requested_run_id: 'run-1',
      run: {
        run_id: 'run-1',
        turn_id: 'turn-1',
        execution_id: 'execution-original',
        status: 'awaiting_user',
        lane: 'foreground',
        pending_interaction: {
          interaction_id: 'interaction-1',
          run_id: 'run-1',
          tool_call_id: 'tool-call-1',
          checkpoint_revision: 1,
          resume_token: 'resume-token-1',
        },
      },
    });

    await reconcileInteractiveRunTransportOutcome('conversation-1', controller, {
      kind: 'failed',
      failure: {
        source: 'server',
        event: {
          type: 'transport_error',
          id: 'transport-error-1',
          timestamp: 1,
          conversation_id: 'conversation-1',
          turn_id: 'turn-1',
          execution_id: 'execution-submit',
          error: 'command rejected',
        },
      },
    });

    expect(store.snapshotFor('conversation-1')).toMatchObject({
      status: 'awaiting_user',
      executionId: 'execution-original',
      pendingInteraction: { interactionId: 'interaction-1' },
      error: 'command rejected',
    });
  });

  it('结算查询失败时本地进入 failed，不保留无限 busy', async () => {
    const store = useInteractiveRunStore();
    const controller = new AbortController();
    store.beginStart('conversation-1', controller);
    store.synchronizeSnapshot('conversation-1', {
      conversationId: 'conversation-1',
      runId: 'run-1',
      status: 'running',
    });
    fetchSettlementMock.mockRejectedValue(new Error('Host unavailable'));

    await reconcileInteractiveRunTransportOutcome('conversation-1', controller, {
      kind: 'failed',
      failure: {
        source: 'client',
        kind: 'network',
        error: new Error('socket closed'),
      },
    });

    expect(store.snapshotFor('conversation-1')).toMatchObject({
      status: 'failed',
      error: 'socket closed; run settlement query failed: Host unavailable',
    });
  });

  it('正常 transport end 只释放 controller，不改写业务状态', async () => {
    const store = useInteractiveRunStore();
    const controller = new AbortController();
    store.beginStart('conversation-1', controller);
    const before = store.snapshotFor('conversation-1');

    await reconcileInteractiveRunTransportOutcome('conversation-1', controller, {
      kind: 'interrupted',
    });

    expect(store.snapshotFor('conversation-1')).toEqual(before);
    expect(fetchSettlementMock).not.toHaveBeenCalled();
    store.abortTransport('conversation-1');
    expect(controller.signal.aborted).toBe(false);
  });
});
