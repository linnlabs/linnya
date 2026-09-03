import { describe, expect, it } from 'vitest';

import type { Conversation } from '../../types';
import { ConversationSelectedAgentIdSchema } from '@app/schemas';
import { createHistoryShellConversation } from './historyShellConversation';

describe('createHistoryShellConversation', () => {
  it('重新打开已有会话时必须保留 live slot，历史 window 加载不能清空流式消息', () => {
    const fallbackConversation: Conversation = {
      id: 'conversation-running',
      title: '运行中的会话',
      titleOrigin: 'explicit',
      createdAt: 1,
      updatedAt: 2,
      selectedAgentId: null,
      messages: [{
        id: 'answer_running',
        role: 'assistant',
        type: 'final_answer',
        content: '已经流出的部分',
        timestamp: 2,
        metadata: {
          answer_id: 'answer-running',
          turn_id: 'turn-running',
          run_id: 'run-running',
          execution_id: 'execution-running',
          is_complete: false,
          first_token_at: 2,
        },
      }],
    };

    const shell = createHistoryShellConversation(
      fallbackConversation.id,
      {
        title: fallbackConversation.title,
        created_at: fallbackConversation.createdAt,
        last_event_at: fallbackConversation.updatedAt,
        project_id: null,
      },
      fallbackConversation,
    );

    expect(shell.messages).toEqual(fallbackConversation.messages);
    expect(shell.messages).not.toBe(fallbackConversation.messages);
  });

  it('以 History DTO 的显式字段恢复 selected Agent', () => {
    const selectedAgentId = ConversationSelectedAgentIdSchema.parse('plugin_agent_fixture');
    const shell = createHistoryShellConversation('conversation-slides', {
      selected_agent_id: selectedAgentId,
    }, null);

    expect(shell.selectedAgentId).toBe(selectedAgentId);
  });

  it('保留 History metadata 的全量用户消息数', () => {
    const shell = createHistoryShellConversation('conversation-counted', {
      user_message_count: 96,
    }, null);

    expect(shell.userMessageCount).toBe(96);
  });
});
