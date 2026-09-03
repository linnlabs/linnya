/**
 * @file summary-purification-integration.test.ts
 * @description 集成测试：验证摘要替换 ID 列表从数据库到历史净化的完整流程
 * 
 * 测试场景：
 * 1. 从数据库读取包含摘要的RuntimeEvent[]
 * 2. 通过 eventConverter 转换为 AiMessage[]
 * 3. 通过 HistoryPurificationPreprocessor 净化历史
 * 4. 验证被摘要替代的消息被正确移除
 */

import { describe, it, expect } from 'vitest';
import { convertEventsToAiMessages } from '../profiles/agent/utils/eventConverter';
import { HistoryPurificationPreprocessor } from '../shared/preprocessors';
import type { RuntimeEvent, AiMessage } from '../../contracts';

describe('摘要历史净化集成测试', () => {
  
  /**
   * 模拟从数据库读取的 RuntimeEvent 历史
   * 场景：摘要替换了 msg-001 到 msg-005
   */
  function createMockHistoryWithSummary(): RuntimeEvent[] {
    const baseTime = Date.now() - 10000;
    
    return [
      // 被摘要替代的消息（应该被移除）
      {
        id: 'msg-001',
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        type: 'user_input',
        timestamp: baseTime,
        version: 1,
        content: '第一条用户消息',
        source: 'user' as const,
      },
      {
        id: 'msg-002',
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        type: 'final_answer',
        timestamp: baseTime + 1000,
        version: 1,
        content: '第一条回答',
        answer_id: 'ans-1',
        is_complete: true,
      },
      {
        id: 'msg-003',
        conversation_id: 'conv-1',
        turn_id: 'turn-2',
        type: 'user_input',
        timestamp: baseTime + 2000,
        version: 1,
        content: '第二条用户消息',
        source: 'user' as const,
      },
      {
        id: 'msg-004',
        conversation_id: 'conv-1',
        turn_id: 'turn-2',
        type: 'final_answer',
        timestamp: baseTime + 3000,
        version: 1,
        content: '第二条回答',
        answer_id: 'ans-2',
        is_complete: true,
      },
      {
        id: 'msg-005',
        conversation_id: 'conv-1',
        turn_id: 'turn-3',
        type: 'user_input',
        timestamp: baseTime + 4000,
        version: 1,
        content: '第三条用户消息',
        source: 'user' as const,
      },
      // 摘要消息（应该保留）
      {
        id: 'summary-1',
        conversation_id: 'conv-1',
        turn_id: 'system',
        type: 'history_summary',
        timestamp: baseTime + 5000,
        version: 1,
        content: '[历史对话摘要 - 压缩了5条消息]\\n\\n这是摘要内容',
        original_message_count: 5,
        compression_ratio: 0.8,
        included_old_summary: false,
        replaced_message_ids: ['msg-001', 'msg-002', 'msg-003', 'msg-004', 'msg-005'],
        summary_seq: 1,
      },
      // 新消息（应该保留）
      {
        id: 'msg-006',
        conversation_id: 'conv-1',
        turn_id: 'turn-4',
        type: 'user_input',
        timestamp: baseTime + 6000,
        version: 1,
        content: '新的用户消息',
        source: 'user' as const,
      },
    ] as RuntimeEvent[];
  }

  it('应该正确净化被摘要替代的历史消息', async () => {
    // 1. 模拟从数据库读取
    const runtimeEvents = createMockHistoryWithSummary();
    console.log('📊 原始 RuntimeEvent 数量:', runtimeEvents.length);
    
    // 2. 通过 eventConverter 转换为 AiMessage
    const aiMessages: AiMessage[] = convertEventsToAiMessages(runtimeEvents);
    console.log('📊 转换后 AiMessage 数量:', aiMessages.length);
    
    // 验证摘要消息的元数据已正确转换
    const summaryMessage = aiMessages.find(m => m.type === 'history_summary');
    expect(summaryMessage).toBeDefined();
    expect(summaryMessage?.metadata?.replacedMessageIds).toEqual(['msg-001', 'msg-002', 'msg-003', 'msg-004', 'msg-005']);
    expect(summaryMessage?.metadata?.summarySeq).toBe(1);
    console.log('✅ 摘要元数据转换正确:', {
      replacedIds: summaryMessage?.metadata?.replacedMessageIds,
      summarySeq: summaryMessage?.metadata?.summarySeq,
    });
    
    // 3. 通过 HistoryPurificationPreprocessor 净化
    const preprocessor = new HistoryPurificationPreprocessor({ logPrefix: 'Agent-HistoryPurification' });
    const result = await preprocessor.process(aiMessages, { debugMode: true });
    
    console.log('📊 净化后消息数量:', result.messages.length);
    console.log('📊 移除的消息数:', aiMessages.length - result.messages.length);
    
    // 4. 验证结果
    // 应该只剩下：摘要 + 新消息 = 2条
    expect(result.messages.length).toBe(2);
    
    const ids = result.messages.map((m: AiMessage) => m.id);
    expect(ids).toContain('summary-1');  // 摘要保留
    expect(ids).toContain('msg-006');    // 新消息保留
    expect(ids).not.toContain('msg-001'); // 被替代的消息移除
    expect(ids).not.toContain('msg-002');
    expect(ids).not.toContain('msg-003');
    expect(ids).not.toContain('msg-004');
    expect(ids).not.toContain('msg-005');
    
    console.log('✅ 历史净化正确！保留的消息ID:', ids);
  });

  it('Agent模式：应该正确净化被摘要替代的历史消息', async () => {
    // 1. 模拟从数据库读取
    const runtimeEvents = createMockHistoryWithSummary();
    
    // 2. 通过 Agent eventConverter 转换
    const aiMessages = convertEventsToAiMessages(runtimeEvents);
    console.log('📊 Agent模式 AiMessage 数量:', aiMessages.length);
    
    // 验证摘要元数据
    const summaryMessage = aiMessages.find(m => m.type === 'history_summary');
    expect(summaryMessage?.metadata?.replacedMessageIds).toEqual(['msg-001', 'msg-002', 'msg-003', 'msg-004', 'msg-005']);
    expect(summaryMessage?.metadata?.summarySeq).toBe(1);
    
    // 3. Agent 历史净化
    const preprocessor = new HistoryPurificationPreprocessor({ logPrefix: 'Agent-HistoryPurification' });
    const result = await preprocessor.process(aiMessages, { debugMode: true });
    
    console.log('📊 Agent净化后:', result.messages.length);
    
    // 4. 验证
    expect(result.messages.length).toBe(2);
    const ids = result.messages.map((m: AiMessage) => m.id);
    expect(ids).toContain('summary-1');
    expect(ids).toContain('msg-006');
    expect(ids).not.toContain('msg-001');
    
    console.log('✅ Agent历史净化正确！');
  });

  it('应该处理递归摘要（摘要替换旧摘要）', async () => {
    const baseTime = Date.now();
    
    const historyWithRecursiveSummary: RuntimeEvent[] = [
      // 第一批消息
      {
        id: 'msg-001',
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        type: 'user_input',
        timestamp: baseTime,
        version: 1,
        content: '消息1',
        source: 'user' as const,
      },
      {
        id: 'msg-002',
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        type: 'final_answer',
        timestamp: baseTime + 1000,
        version: 1,
        content: '回答1',
        answer_id: 'ans-1',
        is_complete: true,
      },
      // 旧摘要（应该被新摘要替代）
      {
        id: 'summary-old',
        conversation_id: 'conv-1',
        turn_id: 'system',
        type: 'history_summary',
        timestamp: baseTime + 2000,
        version: 1,
        content: '旧摘要',
        original_message_count: 2,
        replaced_message_ids: ['msg-001', 'msg-002'],
        summary_seq: 1,
      },
      // 更多消息
      {
        id: 'msg-003',
        conversation_id: 'conv-1',
        turn_id: 'turn-2',
        type: 'user_input',
        timestamp: baseTime + 3000,
        version: 1,
        content: '消息3',
        source: 'user' as const,
      },
      // 新摘要（替换旧摘要 + msg-003）
      {
        id: 'summary-new',
        conversation_id: 'conv-1',
        turn_id: 'system',
        type: 'history_summary',
        timestamp: baseTime + 4000,
        version: 1,
        content: '新摘要（包含旧摘要）',
        original_message_count: 3,
        included_old_summary: true,
        replaced_message_ids: ['summary-old', 'msg-001', 'msg-002', 'msg-003'],
        summary_seq: 2,
      },
      // 最新消息
      {
        id: 'msg-004',
        conversation_id: 'conv-1',
        turn_id: 'turn-3',
        type: 'user_input',
        timestamp: baseTime + 5000,
        version: 1,
        content: '最新消息',
        source: 'user' as const,
      },
    ] as RuntimeEvent[];

    const aiMessages = convertEventsToAiMessages(historyWithRecursiveSummary);
    
    const preprocessor = new HistoryPurificationPreprocessor({ logPrefix: 'Agent-HistoryPurification' });
    const result = await preprocessor.process(aiMessages, { debugMode: true });
    
    console.log('📊 递归摘要测试 - 净化后:', result.messages.length);
    
    // 应该只保留：新摘要 + 最新消息 = 2条
    expect(result.messages.length).toBe(2);
    
    const ids = result.messages.map((m: AiMessage) => m.id);
    expect(ids).toContain('summary-new');  // 新摘要保留
    expect(ids).toContain('msg-004');      // 最新消息保留
    expect(ids).not.toContain('summary-old'); // 旧摘要被移除
    expect(ids).not.toContain('msg-001');
    expect(ids).not.toContain('msg-002');
    expect(ids).not.toContain('msg-003');
    
    console.log('✅ 递归摘要净化正确！旧摘要已被移除。');
  });
});
