import { describe, expect, it } from 'vitest';
import type { Conversation } from '../../types';
import { mergeProjectedConversation } from './projectionCommitPipeline';
import { createTestAnswerMessage } from '../../testing/functions/createConversationTestMessage';
import { ConversationSelectedAgentIdSchema } from '@app/schemas';

function conversation(overrides: Partial<Conversation>): Conversation {
  return {
    id: 'conversation-1',
    title: '标题',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    selectedAgentId: null,
    ...overrides,
  };
}

describe('projectionCommitPipeline ownership', () => {
  it('延迟消息投影不能覆盖更新后的标题', () => {
    const current = conversation({
      title: '用户新标题',
      titleOrigin: 'explicit',
      updatedAt: 20,
    });
    const staleProjection = conversation({
      title: '旧标题快照',
      titleOrigin: 'fallback',
      updatedAt: 10,
      messages: [createTestAnswerMessage({ id: 'message-1', content: '回答', timestamp: 10 })],
    });

    const merged = mergeProjectedConversation(current, staleProjection);

    expect(merged.title).toBe('用户新标题');
    expect(merged.titleOrigin).toBe('explicit');
    expect(merged.updatedAt).toBe(20);
    expect(merged.messages).toEqual(staleProjection.messages);
  });

  it('延迟消息投影不能覆盖会话级 Agent 选择', () => {
    const selectedAgentId = ConversationSelectedAgentIdSchema.parse('plugin_agent_fixture');
    const current = conversation({ selectedAgentId });
    const staleProjection = conversation({ selectedAgentId: null });

    expect(mergeProjectedConversation(current, staleProjection).selectedAgentId).toBe(selectedAgentId);
  });
});
