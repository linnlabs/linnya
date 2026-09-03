import { describe, expect, it } from 'vitest';

import {
  conversationMessageIdFromToolIdentity,
  conversationSubrunMessageIdFromInvocation,
  conversationSubrunMessageIdFromToolIdentity,
} from './message-identity';

describe('Conversation tool message identity', () => {
  it('同一 tool_call_id 在不同 run 中必须派生为不同 UI 实体', () => {
    expect(conversationMessageIdFromToolIdentity('run-a', 'call-shared'))
      .not.toBe(conversationMessageIdFromToolIdentity('run-b', 'call-shared'));
  });

  it('对身份分段编码，原始值包含分隔符时也不能碰撞', () => {
    expect(conversationMessageIdFromToolIdentity('run:a', 'call'))
      .not.toBe(conversationMessageIdFromToolIdentity('run', 'a:call'));
  });

  it('Subrun 工具消息使用独立命名空间并按 subrun 隔离', () => {
    expect(conversationSubrunMessageIdFromToolIdentity('subrun-a', 'call-shared'))
      .not.toBe(conversationSubrunMessageIdFromToolIdentity('subrun-b', 'call-shared'));
    expect(conversationSubrunMessageIdFromToolIdentity('run-a', 'call-shared'))
      .not.toBe(conversationMessageIdFromToolIdentity('run-a', 'call-shared'));
  });

  it('Subrun 调用消息按 subrun 稳定定位且不与 child 工具消息碰撞', () => {
    expect(conversationSubrunMessageIdFromInvocation('subrun-a'))
      .toBe('subrun-user:subrun-a');
    expect(conversationSubrunMessageIdFromInvocation('subrun-a'))
      .not.toBe(conversationSubrunMessageIdFromToolIdentity('subrun-a', 'invocation'));
  });
});
