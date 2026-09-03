import { describe, expect, it } from 'vitest';
import {
  formatConversationCreatedAt,
  formatConversationUserMessageCount,
  projectConversationInformation,
} from './projectConversationInformation';

describe('projectConversationInformation', () => {
  it('长对话优先使用后端全量用户消息数，新会话则使用当前 live 消息数', () => {
    expect(projectConversationInformation({
      createdAt: 1,
      persistedUserMessageCount: 96,
      messages: [
        { type: 'user_input' },
        { type: 'final_answer' },
        { type: 'user_input' },
      ],
    })).toEqual({ createdAt: 1, userMessageCount: 96 });

    expect(projectConversationInformation({
      createdAt: 2,
      messages: [
        { type: 'user_input' },
        { type: 'final_answer' },
        { type: 'user_input' },
      ],
    })).toEqual({ createdAt: 2, userMessageCount: 2 });
  });

  it('创建时间和数量跟随当前语言格式化', () => {
    const timestamp = new Date(2026, 7, 17, 9, 30).getTime();
    expect(formatConversationCreatedAt(timestamp, 'zh-CN')).toContain('2026');
    expect(formatConversationUserMessageCount(12_345, 'en-US')).toBe('12,345');
  });
});
