import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const { apiFetchMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn<typeof fetch>(),
}));

vi.mock('@/shared/services/aiService/common', () => ({
  apiFetch: apiFetchMock,
  getApiBaseUrl: async () => 'http://conversation.test',
}));

import { useInteractiveRunStore } from '../store/interactiveRunStore';
import { cancelInteractiveRun } from './cancelInteractiveRun';

function createCancellationResponse(
  body:
    | {
        readonly outcome: 'cancelled';
        readonly terminal_status: 'cancelled';
      }
    | {
        readonly outcome: 'already_terminal';
        readonly terminal_status: 'completed' | 'failed' | 'cancelled';
      },
): Response {
  return new Response(JSON.stringify({
    success: true,
    run_id: 'run-1',
    ...body,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('cancelInteractiveRun', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    apiFetchMock.mockReset();
  });

  it('取消命令失败后以服务端 active-run 为准恢复 awaiting_user，不永久卡在 cancelling', async () => {
    const store = useInteractiveRunStore();
    store.synchronizeSnapshot('conversation-1', {
      conversationId: 'conversation-1',
      runId: 'run-1',
      turnId: 'turn-1',
      executionId: 'execution-1',
      status: 'awaiting_user',
      pendingInteraction: {
        interactionId: 'interaction-1',
        runId: 'run-1',
        toolCallId: 'ask-ppt-requirements',
        checkpointRevision: 3,
        resumeToken: 'resume-1',
      },
    });
    apiFetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        conversation_id: 'conversation-1',
        run: {
          run_id: 'run-1',
          turn_id: 'turn-1',
          execution_id: 'execution-1',
          status: 'awaiting_user',
          lane: 'foreground',
          pending_interaction: {
            interaction_id: 'interaction-1',
            run_id: 'run-1',
            tool_call_id: 'ask-ppt-requirements',
            checkpoint_revision: 3,
            resume_token: 'resume-1',
          },
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    const reconcileSettledView = vi.fn<(conversationId: string) => Promise<void>>();
    await expect(cancelInteractiveRun('conversation-1', {
      reconcileSettledView,
    })).rejects.toThrow('HTTP 503');

    expect(store.snapshotFor('conversation-1')).toMatchObject({
      runId: 'run-1',
      status: 'awaiting_user',
      pendingInteraction: { interactionId: 'interaction-1' },
      error: expect.stringContaining('HTTP 503'),
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(reconcileSettledView).not.toHaveBeenCalled();
  });

  it('取消命令成功后固定 cancelled 状态并读取 durable tail', async () => {
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
    apiFetchMock.mockResolvedValueOnce(createCancellationResponse({
      outcome: 'cancelled',
      terminal_status: 'cancelled',
    }));
    const reconcileSettledView = vi.fn(async () => {});

    await expect(cancelInteractiveRun('conversation-1', {
      reconcileSettledView,
    })).resolves.toBe(true);

    expect(apiFetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({
        conversation_id: 'conversation-1',
        reason: 'user_cancelled',
      }),
    });

    expect(controller.signal.aborted).toBe(true);
    expect(store.snapshotFor('conversation-1')).toMatchObject({
      runId: 'run-1',
      status: 'cancelled',
    });
    expect(reconcileSettledView).toHaveBeenCalledOnce();
    expect(reconcileSettledView).toHaveBeenCalledWith('conversation-1');
  });

  it('自然完成赢过取消时按 Host 终态收敛，不发起 active-run 错误对账', async () => {
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
    apiFetchMock.mockResolvedValueOnce(createCancellationResponse({
      outcome: 'already_terminal',
      terminal_status: 'completed',
    }));
    const reconcileSettledView = vi.fn(async () => {});

    await expect(cancelInteractiveRun('conversation-1', {
      reconcileSettledView,
    })).resolves.toBe(true);

    expect(controller.signal.aborted).toBe(true);
    expect(store.snapshotFor('conversation-1')).toMatchObject({
      runId: 'run-1',
      status: 'completed',
    });
    expect(apiFetchMock).toHaveBeenCalledOnce();
    expect(reconcileSettledView).toHaveBeenCalledWith('conversation-1');
  });

  it('durable tail 读取失败时保持 cancelled，并明确报告收尾失败', async () => {
    const store = useInteractiveRunStore();
    store.beginStart('conversation-1', new AbortController());
    store.synchronizeSnapshot('conversation-1', {
      conversationId: 'conversation-1',
      runId: 'run-1',
      turnId: 'turn-1',
      executionId: 'execution-1',
      status: 'running',
    });
    apiFetchMock.mockResolvedValueOnce(createCancellationResponse({
      outcome: 'cancelled',
      terminal_status: 'cancelled',
    }));

    await expect(cancelInteractiveRun('conversation-1', {
      reconcileSettledView: async () => {
        throw new Error('tail unavailable');
      },
    })).rejects.toThrow(
      'Run run-1 settled as cancelled, but durable conversation reconciliation failed: tail unavailable',
    );

    expect(store.snapshotFor('conversation-1')).toMatchObject({
      runId: 'run-1',
      status: 'cancelled',
      error: expect.stringContaining('durable conversation reconciliation failed'),
    });
  });

  it('调用方传入的替换原因不会被伪装成用户点击取消', async () => {
    const store = useInteractiveRunStore();
    store.beginStart('conversation-1', new AbortController());
    store.synchronizeSnapshot('conversation-1', {
      conversationId: 'conversation-1',
      runId: 'run-1',
      turnId: 'turn-1',
      executionId: 'execution-1',
      status: 'running',
    });
    apiFetchMock.mockResolvedValueOnce(createCancellationResponse({
      outcome: 'cancelled',
      terminal_status: 'cancelled',
    }));

    await cancelInteractiveRun('conversation-1', {
      reason: 'rerun_replaced_foreground_run',
      reconcileSettledView: async () => {},
    });

    expect(apiFetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({
        conversation_id: 'conversation-1',
        reason: 'rerun_replaced_foreground_run',
      }),
    });
  });
});
