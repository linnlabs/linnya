import { describe, expect, it, vi } from 'vitest';
import { settleAssistantTransportOutcome } from './settleAssistantTransportOutcome';

describe('settleAssistantTransportOutcome', () => {
  it('正式 Conversation 调用方只接收 teardown 后的 typed outcome', async () => {
    const onTransportOutcome = vi.fn();
    const onError = vi.fn();
    const failure = {
      source: 'client' as const,
      kind: 'projection' as const,
      error: new Error('projection failed'),
    };

    await settleAssistantTransportOutcome(
      { onTransportOutcome, onError },
      { kind: 'failed', failure },
    );

    expect(onTransportOutcome).toHaveBeenCalledWith({ kind: 'failed', failure });
    expect(onError).not.toHaveBeenCalled();
  });

  it('没有 control orchestration 的调用方仍从失败 outcome 接收错误', async () => {
    const onError = vi.fn();

    await settleAssistantTransportOutcome(
      { onError },
      {
        kind: 'failed',
        failure: {
          source: 'server',
          event: {
            type: 'transport_error',
            id: 'transport-error-1',
            conversation_id: 'conversation-1',
            turn_id: 'turn-1',
            execution_id: 'execution-1',
            timestamp: 1,
            error: 'host admission failed',
          },
        },
      },
    );

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'host admission failed',
    }));
  });
});
