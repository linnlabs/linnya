import { describe, expect, it } from 'vitest';
import type { InteractiveRunSnapshot } from '../definitions/interactiveRun';
import { projectRunSettlementResponse } from './projectRunSettlementResponse';

const current: InteractiveRunSnapshot = {
  conversationId: 'conversation-1',
  runId: 'run-1',
  turnId: 'turn-1',
  executionId: 'execution-old',
  status: 'submitting',
};

describe('projectRunSettlementResponse', () => {
  it('terminal 结算保留 Renderer 已接纳的 turn/execution identity', () => {
    expect(projectRunSettlementResponse({
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
    }, current)).toEqual({
      conversationId: 'conversation-1',
      runId: 'run-1',
      turnId: 'turn-1',
      executionId: 'execution-old',
      status: 'cancelled',
      error: 'client_disconnected',
    });
  });

  it('active 结算切换到 Host 返回的新 execution', () => {
    expect(projectRunSettlementResponse({
      conversation_id: 'conversation-1',
      requested_run_id: 'run-1',
      run: {
        run_id: 'run-1',
        turn_id: 'turn-1',
        execution_id: 'execution-new',
        status: 'running',
        lane: 'foreground',
      },
    }, current)).toMatchObject({
      runId: 'run-1',
      executionId: 'execution-new',
      status: 'running',
    });
  });

  it('拒绝非当前 run 的结算结果', () => {
    expect(() => projectRunSettlementResponse({
      conversation_id: 'conversation-1',
      requested_run_id: 'run-other',
      run: null,
    }, current)).toThrow('does not match current run identity');
  });
});
