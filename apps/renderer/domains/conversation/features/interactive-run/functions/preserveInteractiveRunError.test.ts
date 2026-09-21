import { describe, expect, it } from 'vitest';
import type { InteractiveRunSnapshot } from '../definitions/interactiveRun';
import { preserveInteractiveRunError } from './preserveInteractiveRunError';

const current: InteractiveRunSnapshot = {
  conversationId: 'conversation-1',
  runId: 'run-1',
  executionId: 'execution-1',
  status: 'failed',
  error: '权限校验失败',
};

describe('preserveInteractiveRunError', () => {
  it('同一 run/execution 的控制面刷新不能清掉横幅错误', () => {
    expect(preserveInteractiveRunError(current, {
      conversationId: 'conversation-1',
      runId: 'run-1',
      executionId: 'execution-1',
      status: 'paused',
    })).toMatchObject({ status: 'paused', error: '权限校验失败' });
  });

  it('新 execution 不继承旧运行的错误', () => {
    expect(preserveInteractiveRunError(current, {
      conversationId: 'conversation-1',
      runId: 'run-1',
      executionId: 'execution-2',
      status: 'running',
    })).toEqual({
      conversationId: 'conversation-1',
      runId: 'run-1',
      executionId: 'execution-2',
      status: 'running',
    });
  });

  it('Host 已返回新错误时使用新错误', () => {
    expect(preserveInteractiveRunError(current, {
      ...current,
      status: 'failed',
      error: '模型服务失败',
    }).error).toBe('模型服务失败');
  });
});
