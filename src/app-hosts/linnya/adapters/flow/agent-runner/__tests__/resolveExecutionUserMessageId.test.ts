import { describe, expect, it } from 'vitest';
import { createUserInputEvent, type RuntimeEvent } from '@linnlabs/linnkit/contracts';

import { resolveExecutionUserMessageId } from '../functions/resolveExecutionUserMessageId';

describe('resolveExecutionUserMessageId', () => {
  it('新 execution 优先绑定本次正式用户输入', () => {
    const history = [
      createUserInputEvent('user-history', 'conversation-1', 'turn-history', '旧问题'),
    ];
    const newEvents = [
      createUserInputEvent('user-current', 'conversation-1', 'turn-current', '新问题'),
    ];

    expect(resolveExecutionUserMessageId(history, newEvents)).toBe('user-current');
  });

  it('wait-user resume 没有新输入时沿用历史中最近的正式用户消息', () => {
    const history: RuntimeEvent[] = [
      createUserInputEvent('user-first', 'conversation-1', 'turn-first', '第一问'),
      createUserInputEvent('user-resumed-run', 'conversation-1', 'turn-resumed', '执行任务'),
    ];

    expect(resolveExecutionUserMessageId(history, [])).toBe('user-resumed-run');
  });
});
