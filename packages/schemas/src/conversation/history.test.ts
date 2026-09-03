import { describe, expect, it } from 'vitest';
import {
  ConversationHistoryListResponseSchema,
  ConversationHistoryMetadataResponseSchema,
  ConversationCleanupRetryResponseSchema,
  UpdateConversationSelectedAgentResponseSchema,
} from './history';

const listItem = {
  conversation_id: 'conversation-1',
  title: '会话',
  created_at: 1,
  last_event_at: 2,
  event_count: 3,
  user_message_count: 1,
  project_id: null,
  is_pinned: false,
  selected_agent_id: 'plugin_agent_fixture',
};

describe('conversation history wire contract', () => {
  it('admits explicit selected agent identity in list and metadata responses', () => {
    expect(ConversationHistoryListResponseSchema.parse({
      success: true,
      conversations: [listItem],
      has_more: false,
    }).conversations[0]?.selected_agent_id).toBe('plugin_agent_fixture');

    expect(ConversationHistoryMetadataResponseSchema.parse({
      success: true,
      ...listItem,
      current_revision: 3,
      mode: 'agent',
    }).selected_agent_id).toBe('plugin_agent_fixture');
  });

  it('rejects hidden control fields and malformed update responses', () => {
    expect(() => ConversationHistoryListResponseSchema.parse({
      success: true,
      conversations: [{ ...listItem, metadata: { promptKey: 'plugin_agent_fixture' } }],
      has_more: false,
    })).toThrow();

    expect(() => UpdateConversationSelectedAgentResponseSchema.parse({
      success: true,
      selected_agent_id: 'plugin_agent_fixture',
      promptKey: 'plugin_agent_fixture',
    })).toThrow();
  });

  it('只暴露用户可见的 cleanup barrier 与重试结果', () => {
    const response = ConversationHistoryListResponseSchema.parse({
      success: true,
      conversations: [{ ...listItem, cleanup_pending: true }],
      has_more: false,
    });
    expect(response.conversations[0]?.cleanup_pending).toBe(true);
    expect(ConversationCleanupRetryResponseSchema.parse({
      success: true,
      outcome: 'work_directory_cleared',
    }).outcome).toBe('work_directory_cleared');
  });
});
