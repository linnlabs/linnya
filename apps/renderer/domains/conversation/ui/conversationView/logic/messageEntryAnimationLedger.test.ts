import { describe, expect, it } from 'vitest';
import type { BaseMessage } from '../../../types';
import {
  createTestAnswerMessage,
  createTestUserMessage,
} from '../../../testing/functions/createConversationTestMessage';
import { createMessageEntryAnimationLedger } from './messageEntryAnimationLedger';

function mkMsg(partial: Partial<BaseMessage> & Pick<BaseMessage, 'id' | 'role' | 'type' | 'content'>): BaseMessage {
  return partial.type === 'user_input'
    ? createTestUserMessage({ id: partial.id, content: partial.content, timestamp: partial.timestamp })
    : createTestAnswerMessage({ id: partial.id, content: partial.content, timestamp: partial.timestamp });
}

describe('messageEntryAnimationLedger', () => {
  it('首次同步已有历史消息时，不应给任何消息入场动画', () => {
    const ledger = createMessageEntryAnimationLedger();
    const messages = [
      mkMsg({ id: 'u1', role: 'user', type: 'user_input', content: '你好' }),
      mkMsg({ id: 'a1', role: 'assistant', type: 'final_answer', content: '你好，有什么我可以帮你？' }),
    ];

    expect(Array.from(ledger.sync('conv-1', messages))).toEqual([]);
  });

  it('同一会话内新增首条用户消息时，应只给新增消息入场动画', () => {
    const ledger = createMessageEntryAnimationLedger();

    expect(Array.from(ledger.sync('conv-1', []))).toEqual([]);

    const firstUserMessage = [
      mkMsg({ id: 'u1', role: 'user', type: 'user_input', content: '帮我总结项目现状' }),
    ];

    expect(Array.from(ledger.sync('conv-1', firstUserMessage))).toEqual(['u1']);
  });

  it('消费后再次同步同一批消息，不应重复产生动画', () => {
    const ledger = createMessageEntryAnimationLedger();
    const messages = [
      mkMsg({ id: 'u1', role: 'user', type: 'user_input', content: '继续' }),
    ];

    ledger.sync('conv-1', []);
    expect(Array.from(ledger.sync('conv-1', messages))).toEqual(['u1']);

    expect(Array.from(ledger.consume('u1'))).toEqual([]);
    expect(Array.from(ledger.sync('conv-1', messages))).toEqual([]);
  });

  it('同一会话后续追加 assistant 消息时，只应动画新追加部分', () => {
    const ledger = createMessageEntryAnimationLedger();
    const userOnly = [
      mkMsg({ id: 'u1', role: 'user', type: 'user_input', content: '分析一下' }),
    ];
    const withAnswer = [
      ...userOnly,
      mkMsg({ id: 'a1', role: 'assistant', type: 'final_answer', content: '这是分析结果' }),
    ];

    ledger.sync('conv-1', []);
    ledger.sync('conv-1', userOnly);
    ledger.consume('u1');

    expect(Array.from(ledger.sync('conv-1', withAnswer))).toEqual(['a1']);
  });

  it('切换到另一条已有历史的会话时，应把当前消息视为基线而不是新消息', () => {
    const ledger = createMessageEntryAnimationLedger();
    const conv1 = [
      mkMsg({ id: 'u1', role: 'user', type: 'user_input', content: 'Q1' }),
    ];
    const conv2History = [
      mkMsg({ id: 'u2', role: 'user', type: 'user_input', content: 'Q2' }),
      mkMsg({ id: 'a2', role: 'assistant', type: 'final_answer', content: 'A2' }),
    ];

    ledger.sync('conv-1', []);
    ledger.sync('conv-1', conv1);
    ledger.consume('u1');

    expect(Array.from(ledger.sync('conv-2', conv2History))).toEqual([]);
  });

  it('截断后重新追加新消息时，应只动画新的 message id', () => {
    const ledger = createMessageEntryAnimationLedger();
    const firstRun = [
      mkMsg({ id: 'u1', role: 'user', type: 'user_input', content: 'Q1' }),
      mkMsg({ id: 'a1', role: 'assistant', type: 'final_answer', content: 'A1' }),
    ];
    const truncated = [
      mkMsg({ id: 'u1', role: 'user', type: 'user_input', content: 'Q1' }),
    ];
    const regenerated = [
      ...truncated,
      mkMsg({ id: 'a2', role: 'assistant', type: 'final_answer', content: 'A2' }),
    ];

    ledger.sync('conv-1', []);
    ledger.sync('conv-1', firstRun);
    ledger.consume('u1');
    ledger.consume('a1');

    expect(Array.from(ledger.sync('conv-1', truncated))).toEqual([]);
    expect(Array.from(ledger.sync('conv-1', regenerated))).toEqual(['a2']);
  });

  it('待播放消息如果在挂载前被截断，应从 pending 集合中移除', () => {
    const ledger = createMessageEntryAnimationLedger();
    const appended = [
      mkMsg({ id: 'u1', role: 'user', type: 'user_input', content: 'Q1' }),
      mkMsg({ id: 'a1', role: 'assistant', type: 'final_answer', content: 'A1' }),
    ];
    const truncated = [
      mkMsg({ id: 'u1', role: 'user', type: 'user_input', content: 'Q1' }),
    ];

    ledger.sync('conv-1', []);
    expect(Array.from(ledger.sync('conv-1', appended))).toEqual(['u1', 'a1']);
    expect(Array.from(ledger.sync('conv-1', truncated))).toEqual(['u1']);
  });
});
