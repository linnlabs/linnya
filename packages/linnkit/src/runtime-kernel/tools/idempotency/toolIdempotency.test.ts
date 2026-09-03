import { describe, expect, it } from 'vitest';

import {
  computeToolIdempotencyKey,
  findCachedToolOutputByIdempotencyKey,
} from './toolIdempotency';
import { createToolOutputEvent } from '../../../contracts';

describe('toolIdempotency', () => {
  it('生成至少 128bit 的稳定 key，避免短 digest 碰撞静默命中错误输出', () => {
    const first = computeToolIdempotencyKey({
      policy: { scope: 'conversation' },
      toolName: 'search',
      args: { filters: { b: 2, a: 1 }, query: 'hello' },
      context: { conversationId: 'conv-1', turnId: 'turn-1' },
    });
    const second = computeToolIdempotencyKey({
      policy: { scope: 'conversation' },
      toolName: 'search',
      args: { query: 'hello', filters: { a: 1, b: 2 } },
      context: { conversationId: 'conv-1', turnId: 'turn-1' },
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{32}$/);
  });

  it('conversation scope 缺 conversationId 时应显式失败，不允许降级成 turn scope', () => {
    expect(() => computeToolIdempotencyKey({
      policy: { scope: 'conversation' },
      toolName: 'search',
      args: { query: 'hello' },
      context: { turnId: 'turn-1' },
    })).toThrow(/conversationId/);
  });

  it('turn scope 缺 turnId 时应显式失败，不允许使用 unknown_turn', () => {
    expect(() => computeToolIdempotencyKey({
      policy: { scope: 'turn' },
      toolName: 'search',
      args: { query: 'hello' },
      context: { conversationId: 'conv-1' },
    })).toThrow(/turnId/);
  });

  it('按 idempotency metadata 从最近的成功 tool_output 中读取缓存输出', () => {
    const cached = findCachedToolOutputByIdempotencyKey({
      history: [
        createToolOutputEvent('old-output', 'conv-1', 'turn-1', 'search', 'call-1', {
          status: 'success', observation: 'old', data: { value: 'old' },
        }, {
          metadata: { idempotency: { key: 'idem-key' } },
        }),
        createToolOutputEvent('new-output', 'conv-1', 'turn-2', 'search', 'call-2', {
          status: 'success', observation: 'new', data: { value: 'new' },
        }, {
          metadata: { idempotency: { key: 'idem-key' } },
        }),
      ],
      toolName: 'search',
      idempotencyKey: 'idem-key',
    });

    expect(cached).toEqual({
      result: JSON.stringify({ data: { value: 'new' }, observation: 'new' }),
    });
  });
});
