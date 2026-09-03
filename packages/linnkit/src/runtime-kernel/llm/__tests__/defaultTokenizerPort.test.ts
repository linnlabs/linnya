import { describe, expect, it } from 'vitest';
import type { LlmRequestMessage } from '../../../ports';
import { TokenCalculator } from '../../../shared/TokenCalculator';
import { createDefaultTokenizerPort } from '../defaultTokenizerPort';

describe('DefaultTokenizerPort', () => {
  it('matches TokenCalculator message estimation', () => {
    const message: LlmRequestMessage = {
      role: 'assistant',
      content: 'hello',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'lookup', arguments: '{"q":"hello"}' },
        },
      ],
    };
    const config = {
      avgCharsPerToken: 2,
      toolCallOverhead: 17,
    };

    const tokenizer = createDefaultTokenizerPort(config);

    expect(tokenizer.estimateMessage(message, 'model-a')).toBe(
      TokenCalculator.estimateMessageTokens(message, config),
    );
  });

  it('does not infer encoding from modelId when no encoding is configured', () => {
    const tokenizer = createDefaultTokenizerPort({
      avgCharsPerToken: 2,
    });

    expect(tokenizer.estimateText('hello world', 'model-a')).toBe(6);
    expect(tokenizer.estimateText('hello world', 'model-b')).toBe(6);
  });

  it('keeps explicit encoding ahead of modelId', () => {
    const tokenizer = createDefaultTokenizerPort({
      encoding: 'cl100k_base',
      avgCharsPerToken: 2,
    });

    expect(tokenizer.estimateText('hello world', 'model-a')).toBe(
      TokenCalculator.estimateTokens('hello world', {
        encoding: 'cl100k_base',
        avgCharsPerToken: 2,
      }),
    );
  });
});
