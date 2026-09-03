import { describe, expect, it } from 'vitest';

import type { ConversationNextRequest } from '@app/schemas';
import { assignIncomingEventIds } from './flow.incoming-event-identities';

describe('assignIncomingEventIds', () => {
  it('在 Flow 入口一次性补全身份，并保留调用方已有身份', () => {
    const request: ConversationNextRequest = {
      conversation_id: 'conv-1',
      new_events: [
        {
          type: 'user_input',
          timestamp: 1,
          content: '当前问题',
          source: 'user',
        },
        {
          type: 'tool_output',
          id: 'existing-tool-event',
          timestamp: 2,
          tool_call_id: 'call-1',
          tool_name: 'search',
          observation: 'result',
          data: {},
          status: 'success',
        },
      ],
    };

    const assigned = assignIncomingEventIds(request, () => 'generated-user-event');

    expect(assigned.new_events?.map(event => event.id)).toEqual([
      'generated-user-event',
      'existing-tool-event',
    ]);
    expect(request.new_events?.[0]?.id).toBeUndefined();
  });

  it('所有事件已有身份时保持原请求对象，避免重复聚合', () => {
    const request: ConversationNextRequest = {
      conversation_id: 'conv-1',
      new_events: [{
        type: 'user_input',
        id: 'user-event',
        timestamp: 1,
        content: '当前问题',
        source: 'user',
      }],
    };

    expect(assignIncomingEventIds(request)).toBe(request);
  });
});
