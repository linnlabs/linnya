import { describe, expect, it, vi } from 'vitest';
import type { SSEThoughtEvent } from '@linnlabs/linnkit/contracts';

import type { ConversationEventDispatcher } from '../definitions/conversationEventDispatcher';
import { createConversationRequestEventRouter } from './createConversationRequestEventRouter';

function createThoughtEvent(conversationId: string): SSEThoughtEvent {
  return {
    type: 'thought',
    id: `thought-${conversationId}`,
    conversation_id: conversationId,
    turn_id: 'turn-1',
    timestamp: 1,
    content: '正在分析',
    is_complete: true,
  };
}

describe('conversation request event router', () => {
  it('请求收到其它 conversation 的事件时，应在写入 dispatcher 前失败', async () => {
    const dispatcher = vi.fn<ConversationEventDispatcher>(async () => ({ success: true }));
    const routeEvent = createConversationRequestEventRouter({
      conversationId: 'conversation-a',
      signal: new AbortController().signal,
      dispatcher,
    });

    await expect(routeEvent(createThoughtEvent('conversation-b'))).rejects.toThrow(
      'conversation-b !== conversation-a',
    );
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it('hidden 只约束源消息，过程事件仍保留 activity 并进入请求自己的 dispatcher', async () => {
    const dispatcher = vi.fn<ConversationEventDispatcher>(async () => ({ success: true }));
    const routeEvent = createConversationRequestEventRouter({
      conversationId: 'conversation-a',
      signal: new AbortController().signal,
      dispatcher,
      routeContext: {
        ui: { presentation: 'hidden' },
        activity: { runId: 'activity-1', feature: 'table_fill' },
      },
    });

    await expect(routeEvent(createThoughtEvent('conversation-a'))).resolves.toBe(true);
    expect(dispatcher).toHaveBeenCalledWith(
      'conversation-a',
      expect.objectContaining({
        metadata: {
          activity: { runId: 'activity-1', feature: 'table_fill' },
        },
      }),
    );
  });
});
