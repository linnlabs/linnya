import { describe, expect, it, vi } from 'vitest';

vi.mock('../../message-window', () => ({
  reconcileTerminalConversationWindow: vi.fn(),
}));

import { reconcileTerminalConversationView } from './reconcileTerminalConversationView';

describe('reconcileTerminalConversationView', () => {
  it('先读取父工具 durable window，再通知已展开 subrun trace 重读', async () => {
    const order: string[] = [];

    await reconcileTerminalConversationView('conversation-settled', {
      reconcileWindow: vi.fn(async () => {
        order.push('window');
      }),
      invalidateSubrunTrace: vi.fn(() => {
        order.push('subrun-trace');
      }),
    });

    expect(order).toEqual(['window', 'subrun-trace']);
  });

  it('window 重读失败时不发布一个虚假的 trace 可刷新信号', async () => {
    const invalidateSubrunTrace = vi.fn();

    await expect(reconcileTerminalConversationView('conversation-settled', {
      reconcileWindow: async () => {
        throw new Error('window unavailable');
      },
      invalidateSubrunTrace,
    })).rejects.toThrow('window unavailable');

    expect(invalidateSubrunTrace).not.toHaveBeenCalled();
  });
});
