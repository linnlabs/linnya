import { describe, expect, it } from 'vitest';
import { ConversationNextRequest } from '../api-dtos';

describe('ConversationNextRequest selected agent contract', () => {
  it('接纳会话级 selected_agent_id，并拒绝与 promptKey 同时出现', () => {
    expect(ConversationNextRequest.parse({
      conversation_id: 'conversation-1',
      options: { selected_agent_id: 'plugin_agent_fixture' },
    }).options?.selected_agent_id).toBe('plugin_agent_fixture');

    expect(() => ConversationNextRequest.parse({
      conversation_id: 'conversation-1',
      options: {
        selected_agent_id: 'plugin_agent_fixture',
        promptKey: 'plugin_agent_fixture',
      },
    })).toThrow('selected_agent_id 与 promptKey 不能同时出现');
  });
});
