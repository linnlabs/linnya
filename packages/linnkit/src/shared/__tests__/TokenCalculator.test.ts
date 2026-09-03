import { describe, expect, it } from 'vitest';
import { TokenCalculator } from '../TokenCalculator';
import type { AiMessage } from '../../contracts';
import { ToolCallIdSchema } from '../../contracts';

function makeToolCallMessage(): AiMessage {
  return {
    id: 'assistant_tool_calls',
    role: 'assistant',
    type: 'tool_calls',
    content: '',
    timestamp: 1,
    metadata: {
      tool_calls: [
        {
          id: ToolCallIdSchema.parse('call_1'),
          type: 'function',
          function: {
            name: 'search',
            arguments: '{"query":"linnkit"}',
          },
        },
      ],
    },
  };
}

describe('TokenCalculator configurable estimation', () => {
  it('uses avgCharsPerToken as the fallback estimator when no encoding is provided', () => {
    expect(TokenCalculator.estimateTokens('123456789', { avgCharsPerToken: 3 })).toBe(3);
  });

  it('uses configurable toolCallOverhead when estimating tool call messages', () => {
    const message = makeToolCallMessage();

    const lowOverhead = TokenCalculator.estimateMessageTokens(message, {
      avgCharsPerToken: 2,
      toolCallOverhead: 10,
    });
    const highOverhead = TokenCalculator.estimateMessageTokens(message, {
      avgCharsPerToken: 2,
      toolCallOverhead: 70,
    });

    expect(highOverhead - lowOverhead).toBe(60);
  });

  it('estimates canonical replay parts without double-counting projected content', () => {
    const message: AiMessage = {
      ...makeToolCallMessage(),
      content: '这段投影正文不会重复计数',
      metadata: {
        ...makeToolCallMessage().metadata,
        assistant_replay_parts: [
          { type: 'reasoning', text: '123456' },
          { type: 'text', text: 'abcd' },
          { type: 'tool_call', tool_call_id: ToolCallIdSchema.parse('call_1') },
        ],
      },
    };

    const options = {
      avgCharsPerToken: 2,
      toolCallOverhead: 10,
    };
    const expected = 5
      + TokenCalculator.estimateTokens('123456', options)
      + TokenCalculator.estimateTokens('abcd', options)
      + options.toolCallOverhead
      + TokenCalculator.estimateTokens('search', options)
      + TokenCalculator.estimateTokens('{"query":"linnkit"}', options);

    expect(TokenCalculator.estimateMessageTokens(message, options)).toBe(expected);
  });

  it('accepts an explicit encoding name without treating it as a model id', () => {
    const tokens = TokenCalculator.estimateTokens('hello world', {
      encoding: 'o200k_base',
      avgCharsPerToken: 2,
    });

    expect(tokens).toBeGreaterThan(0);
  });
});
