import { describe, expect, it } from 'vitest';
import {
  assertToolConversationScopeContext,
  requireToolConversationScope,
  resolveToolConversationId,
  resolveToolConversationInstanceId,
} from '..';

describe('tool conversation scope', () => {
  it('从 Host ToolContext 投影 conversation 与 research instance 分区', () => {
    const context = {
      conversationId: ' conv_scope ',
      research: { instanceId: ' inst_scope ' },
    };

    expect(resolveToolConversationId(context)).toBe('conv_scope');
    expect(resolveToolConversationInstanceId(context)).toBe('inst_scope');
    expect(requireToolConversationScope({ context, errorPrefix: '[test]' })).toEqual({
      conversationId: 'conv_scope',
      instanceId: 'inst_scope',
    });
  });

  it('默认 instance 只在 conversation 身份存在时生效', () => {
    expect(
      requireToolConversationScope({
        context: { conversationId: 'conv_default' },
        errorPrefix: '[test]',
      }),
    ).toEqual({ conversationId: 'conv_default', instanceId: 'default' });

    expect(() =>
      assertToolConversationScopeContext({}, '[test]'),
    ).toThrow('[test] 缺少 context.conversationId');
  });
});
