import { describe, expect, it } from 'vitest';
import { ConversationNextRequest } from '../src/api-dtos';
import { UserQuoteSchema } from '../src/conversation/user-quote';

describe('UserQuoteSchema', () => {
  it('接受结构化 items 并保留每条身份与业务事实', () => {
    const result = UserQuoteSchema.parse({
      items: [{
        quote_id: 'reference-11111111111111111111111111111111',
        plugin_id: 'slides',
        kind: 'slides-source-selection',
        uri: 'linnya://slides/deck-1#slide/1',
        text: '第 1 页元素',
        label: '第 1 页',
        source: { slide_number: 1 },
        metadata: { presentationId: 'deck-1' },
      }],
    });

    expect(result.items[0]).toMatchObject({
      plugin_id: 'slides',
      kind: 'slides-source-selection',
      source: { slide_number: 1 },
      metadata: { presentationId: 'deck-1' },
    });
  });

  it('拒绝旧扁平形状、空 items 与不可序列化元数据', () => {
    expect(UserQuoteSchema.safeParse({ text: 'legacy quote' }).success).toBe(false);
    expect(UserQuoteSchema.safeParse({ items: [] }).success).toBe(false);
    expect(UserQuoteSchema.safeParse({
      items: [{
        quote_id: 'reference-11111111111111111111111111111111',
        plugin_id: ' platform ',
        kind: 'text-selection',
        text: 'quote',
      }],
    }).success).toBe(false);
    expect(UserQuoteSchema.safeParse({
      items: [{
        quote_id: 'reference-11111111111111111111111111111111',
        plugin_id: 'platform',
        kind: 'text-selection',
        text: 'quote',
        metadata: { invalid: undefined },
      }],
    }).success).toBe(false);
  });

  it('在 conversation ingress 校验 user_input metadata 内的新 wire', () => {
    const requestBase = {
      conversation_id: 'conversation-1',
      new_events: [{
        type: 'user_input' as const,
        timestamp: 1,
        content: 'hello',
        source: 'user' as const,
      }],
    };

    expect(ConversationNextRequest.safeParse({
      ...requestBase,
      new_events: [{
        ...requestBase.new_events[0],
        metadata: {
          user_quote: {
            items: [{
              quote_id: 'reference-11111111111111111111111111111111',
              plugin_id: 'platform',
              kind: 'text-selection',
              text: 'quote',
            }],
          },
        },
      }],
    }).success).toBe(true);

    expect(ConversationNextRequest.safeParse({
      ...requestBase,
      new_events: [{
        ...requestBase.new_events[0],
        metadata: { user_quote: { text: 'legacy quote' } },
      }],
    }).success).toBe(false);
  });
});
