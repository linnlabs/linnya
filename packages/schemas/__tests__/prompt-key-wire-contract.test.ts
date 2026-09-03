import { describe, expect, it } from 'vitest';

import { AgentInvokeRequest, ConversationOptions } from '../src/api-dtos';

describe('promptKey wire contract', () => {
  it('allows plugin-owned prompt keys through API DTO validation', () => {
    const conversation = ConversationOptions.safeParse({
      promptKey: 'plugin/custom-agent',
    });
    expect(conversation.success).toBe(true);

    const agent = AgentInvokeRequest.safeParse({
      query: 'hello',
      promptKey: 'plugin/custom-agent',
    });
    expect(agent.success).toBe(true);
    if (!agent.success) {
      throw agent.error;
    }
    expect(agent.data.maxSteps).toBeUndefined();
  });

  it('still rejects non-string prompt keys at the wire boundary', () => {
    expect(ConversationOptions.safeParse({ promptKey: 123 }).success).toBe(false);
    expect(AgentInvokeRequest.safeParse({ query: 'hello', promptKey: 123 }).success).toBe(false);
  });
});

describe('host tool call wire contract', () => {
  it('只接受非空工具名和可序列化 JSON 参数', () => {
    const parsed = ConversationOptions.parse({
      host_tool_call: {
        tool_name: '  test_tool  ',
        args: {
          unitIds: ['row-1', 'row-2'],
          retry: false,
          limit: 2,
          note: null,
        },
      },
    });

    expect(parsed.host_tool_call?.tool_name).toBe('test_tool');
    expect(ConversationOptions.safeParse({
      host_tool_call: { tool_name: ' ', args: {} },
    }).success).toBe(false);
    expect(ConversationOptions.safeParse({
      host_tool_call: { tool_name: 'test_tool', args: { invalid: Number.NaN } },
    }).success).toBe(false);
  });
});

describe('activity binding wire contract', () => {
  it('通过 activity 透传外部运行归属', () => {
    const parsed = ConversationOptions.parse({
      activity: { runId: 'run-1', feature: 'table_fill' },
    });
    expect(parsed.activity).toEqual({ runId: 'run-1', feature: 'table_fill' });
  });
});

describe('history isolation wire contract', () => {
  it('只接受明确的 isolated 模式', () => {
    expect(ConversationOptions.parse({ history_mode: 'isolated' }).history_mode).toBe('isolated');
    expect(ConversationOptions.safeParse({ history_mode: true }).success).toBe(false);
    expect(ConversationOptions.safeParse({ history_mode: 'stateless' }).success).toBe(false);
  });
});
