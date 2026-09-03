import { describe, expect, it } from 'vitest';

import { resolveSubrunCardTraceSource } from '../functions/resolveSubrunCardTraceSource';

const source = {
  conversationId: 'conversation-a',
  parentToolCallId: 'parent-call',
  kinds: ['tool_process' as const],
};

describe('resolveSubrunCardTraceSource', () => {
  it('使用 presentation 的 child ID 补全历史读取三元身份', () => {
    expect(resolveSubrunCardTraceSource({
      source,
      subrunId: 'subrun-a',
      kinds: ['thought_complete'],
    })).toEqual({
      ...source,
      subrunId: 'subrun-a',
      kinds: ['thought_complete'],
    });
  });

  it('拒绝 collection source 与卡片 presentation 的身份冲突', () => {
    expect(() => resolveSubrunCardTraceSource({
      source: { ...source, subrunId: 'subrun-a' },
      subrunId: 'subrun-b',
      kinds: ['thought_complete'],
    })).toThrow('[SUBRUN_CARD_SOURCE_IDENTITY_CONFLICT]');
  });
});
