/**
 * 测试重构后的历史净化器
 * 验证基于 replacedMessageIds 和 summarySeq 的新策略
 */

import { describe, it, expect } from 'vitest';
import { HistoryPurificationPreprocessor } from '../shared/preprocessors';
import { AiMessage } from '../../contracts';

describe('HistoryPurificationPreprocessor - 重构后测试', () => {
  const purifier = new HistoryPurificationPreprocessor({ logPrefix: 'Test-HistoryPurification' });
  
  const mockContext = {
    conversationId: 'test-conv',
    debug: () => {} // 静默调试输出
  };

  /**
   * 辅助函数：创建测试消息
   */
  function createMessage(
    id: string, 
    type: 'user_input' | 'final_answer' | 'history_summary',
    metadata?: unknown
  ): AiMessage {
    const role = type === 'user_input' ? 'user' : type === 'history_summary' ? 'system' : 'assistant';
    return AiMessage.parse({
      id,
      role,
      type,
      content: `Content of ${id}`,
      timestamp: Date.now(),
      metadata
    });
  }

  it('应该使用 summarySeq 查找最新摘要（而非 timestamp）', async () => {
    const messages: AiMessage[] = [
      createMessage('msg-1', 'user_input'),
      createMessage('msg-2', 'final_answer'),
      // 旧摘要：timestamp 更大但 summarySeq 更小
      createMessage('summary-old', 'history_summary', {
        summarySeq: 1,
        replacedMessageIds: ['msg-1', 'msg-2'],
        originalMessageCount: 2
      }),
      createMessage('msg-3', 'user_input'),
      createMessage('msg-4', 'final_answer'),
      // 新摘要：timestamp 更小但 summarySeq 更大（应该被使用）
      createMessage('summary-new', 'history_summary', {
        summarySeq: 2,
        replacedMessageIds: ['summary-old', 'msg-3', 'msg-4'],
        originalMessageCount: 3
      }),
      createMessage('msg-5', 'user_input'),
    ];

    // 手动调整 timestamp，让旧摘要的时间戳更大
    messages[2].timestamp = Date.now() + 1000;
    messages[5].timestamp = Date.now() - 1000;

    const result = await purifier.process(messages, mockContext);

    // 验证：应该使用 summarySeq=2 的摘要，移除 summary-old、msg-3、msg-4
    expect(result.messages).toHaveLength(4);
    expect(result.messages.map(m => m.id)).toEqual([
      'msg-1',
      'msg-2',
      'summary-new',
      'msg-5'
    ]);
  });

  it('应该使用精确ID列表移除消息', async () => {
    const messages: AiMessage[] = [
      createMessage('msg-1', 'user_input'),
      createMessage('msg-2', 'final_answer'),
      createMessage('msg-3', 'user_input'),
      createMessage('msg-4', 'final_answer'),
      createMessage('summary-1', 'history_summary', {
        summarySeq: 1,
        replacedMessageIds: ['msg-1', 'msg-2'], // 只移除这两条
        originalMessageCount: 2
      }),
      createMessage('msg-5', 'user_input'),
    ];

    const result = await purifier.process(messages, mockContext);

    // 验证：msg-1 和 msg-2 被移除，其他保留
    expect(result.messages).toHaveLength(4);
    expect(result.messages.map(m => m.id)).toEqual([
      'msg-3',
      'msg-4',
      'summary-1',
      'msg-5'
    ]);
  });

  it('应该支持"自我吞噬"机制（旧摘要被新摘要替换）', async () => {
    const messages: AiMessage[] = [
      createMessage('msg-1', 'user_input'),
      createMessage('msg-2', 'final_answer'),
      createMessage('summary-1', 'history_summary', {
        summarySeq: 1,
        replacedMessageIds: ['msg-1', 'msg-2'],
        originalMessageCount: 2,
        includedOldSummary: false
      }),
      createMessage('msg-3', 'user_input'),
      createMessage('msg-4', 'final_answer'),
      createMessage('summary-2', 'history_summary', {
        summarySeq: 2,
        // 🔥 包含所有应被替换的消息：旧摘要 + 之前被摘要压缩的消息 + 新消息
        replacedMessageIds: ['msg-1', 'msg-2', 'summary-1', 'msg-3', 'msg-4'],
        originalMessageCount: 5,
        includedOldSummary: true
      }),
      createMessage('msg-5', 'user_input'),
    ];

    const result = await purifier.process(messages, mockContext);

    // 验证：旧摘要 summary-1 也被移除
    expect(result.messages).toHaveLength(2);
    expect(result.messages.map(m => m.id)).toEqual([
      'summary-2',
      'msg-5'
    ]);
  });

  it('如果摘要缺少 replacedMessageIds，应该跳过净化', async () => {
    const messages: AiMessage[] = [
      createMessage('msg-1', 'user_input'),
      createMessage('msg-2', 'final_answer'),
      createMessage('summary-bad', 'history_summary', {
        summarySeq: 1,
        // 缺少 replacedMessageIds
        originalMessageCount: 2
      }),
      createMessage('msg-3', 'user_input'),
    ];

    const result = await purifier.process(messages, mockContext);

    // 验证：没有移除任何消息
    expect(result.messages).toHaveLength(4);
    expect(result.messages).toEqual(messages);
  });

  it('如果没有摘要消息，应该跳过预处理器', async () => {
    const messages: AiMessage[] = [
      createMessage('msg-1', 'user_input'),
      createMessage('msg-2', 'final_answer'),
      createMessage('msg-3', 'user_input'),
      createMessage('msg-4', 'final_answer'),
    ];

    const result = await purifier.process(messages, mockContext);

    // 验证：所有消息保留
    expect(result.messages).toHaveLength(4);
    expect(result.messages).toEqual(messages);
  });

  it('应该处理空的 replacedMessageIds 数组', async () => {
    const messages: AiMessage[] = [
      createMessage('msg-1', 'user_input'),
      createMessage('summary-empty', 'history_summary', {
        summarySeq: 1,
        replacedMessageIds: [], // 空数组
        originalMessageCount: 1
      }),
      createMessage('msg-2', 'user_input'),
    ];

    const result = await purifier.process(messages, mockContext);

    // 验证：没有移除任何消息（因为列表为空）
    expect(result.messages).toHaveLength(3);
    expect(result.messages).toEqual(messages);
  });

  it('应该正确处理多个摘要但只使用最新的', async () => {
    const messages: AiMessage[] = [
      createMessage('msg-1', 'user_input'),
      createMessage('summary-1', 'history_summary', {
        summarySeq: 1,
        replacedMessageIds: ['msg-1'],
        originalMessageCount: 1
      }),
      createMessage('msg-2', 'user_input'),
      createMessage('summary-2', 'history_summary', {
        summarySeq: 2,
        replacedMessageIds: ['msg-1', 'summary-1', 'msg-2'],  // 包含所有历史
        originalMessageCount: 3
      }),
      createMessage('msg-3', 'user_input'),
      createMessage('summary-3', 'history_summary', {
        summarySeq: 3,
        replacedMessageIds: ['msg-1', 'summary-1', 'msg-2', 'summary-2', 'msg-3'],  // 包含所有历史
        originalMessageCount: 5
      }),
      createMessage('msg-4', 'user_input'),
    ];

    const result = await purifier.process(messages, mockContext);

    // 验证：只使用 summarySeq=3 的摘要
    expect(result.messages).toHaveLength(2);
    expect(result.messages.map(m => m.id)).toEqual([
      'summary-3',
      'msg-4'
    ]);
  });

  it('应该忽略不在消息列表中的 replacedMessageIds', async () => {
    const messages: AiMessage[] = [
      createMessage('msg-1', 'user_input'),
      createMessage('msg-2', 'final_answer'),
      createMessage('summary-1', 'history_summary', {
        summarySeq: 1,
        replacedMessageIds: [
          'msg-1', 
          'non-existent-id-1',  // 不存在的ID
          'non-existent-id-2',  // 不存在的ID
          'msg-2'
        ],
        originalMessageCount: 4
      }),
      createMessage('msg-3', 'user_input'),
    ];

    const result = await purifier.process(messages, mockContext);

    // 验证：只移除存在的消息，不会因为不存在的ID而出错
    expect(result.messages).toHaveLength(2);
    expect(result.messages.map(m => m.id)).toEqual([
      'summary-1',
      'msg-3'
    ]);
  });
});
