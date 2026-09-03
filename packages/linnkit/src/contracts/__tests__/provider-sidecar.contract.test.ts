import { describe, expect, it } from 'vitest';

import { validateAiMessage } from '../messages';

describe('provider continuation contracts', () => {
  it('AiMessage metadata preserves identified continuations on ordered replay parts', () => {
    const providerContinuations = [{
      schema_version: 2 as const,
      producer: {
        model_id: 'deepseek-reasoner',
        endpoint_id: 'deepseek',
        api_surface: 'openai_chat_completions',
        capability_id: 'test:chat-codec',
        endpoint_model_id: 'deepseek-reasoner',
      },
      kind: 'reasoning_content',
      payload: { provider: 'deepseek', type: 'reasoning_content', reasoning_content: 'Need the tool.' },
    }];

    const parsed = validateAiMessage({
      id: 'msg_tool_calls_1',
      role: 'assistant',
      type: 'tool_calls',
      content: '',
      timestamp: 1,
      metadata: {
        provider_continuations: providerContinuations,
        assistant_replay_parts: [{
          type: 'tool_call',
          tool_call_id: 'call_1',
          provider_continuations: providerContinuations,
        }],
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'workspace_read', arguments: '{}' },
          },
        ],
      },
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }
    expect(parsed.data.metadata?.provider_continuations).toEqual(providerContinuations);
    expect(parsed.data.metadata?.assistant_replay_parts?.[0]?.provider_continuations)
      .toEqual(providerContinuations);
  });

  it('rejects provider-private fields embedded in canonical tool calls', () => {
    const parsed = validateAiMessage({
      id: 'msg_tool_calls_legacy',
      role: 'assistant',
      type: 'tool_calls',
      content: '',
      timestamp: 1,
      metadata: {
        tool_calls: [{
          id: 'call_legacy',
          type: 'function',
          function: { name: 'workspace_read', arguments: '{}' },
          extra_content: { vendor: { opaque_replay_state: '<state>' } },
        }],
      },
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      throw new Error('expected provider-private tool call fields to be rejected');
    }
    expect(parsed.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'unrecognized_keys',
        path: ['metadata', 'tool_calls', 0],
        keys: ['extra_content'],
      }),
    ]));
  });
});
