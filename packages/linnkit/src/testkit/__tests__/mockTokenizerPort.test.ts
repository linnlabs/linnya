import { describe, expect, it } from 'vitest';
import { createMockTokenizerPort } from '../mocks/tokenizerPort';

describe('createMockTokenizerPort', () => {
  it('returns deterministic test values', () => {
    const tokenizer = createMockTokenizerPort({
      tokensPerText: 100,
      tokensPerMessage: 250,
    });

    expect(tokenizer.estimateText('anything')).toBe(100);
    expect(tokenizer.estimateMessage({ role: 'user', content: 'anything' })).toBe(250);
  });

  it('allows callback overrides', () => {
    const tokenizer = createMockTokenizerPort({
      estimateText: (text, modelId) => text.length + (modelId === 'm' ? 1 : 0),
      estimateMessage: (_message, modelId) => (modelId === 'm' ? 7 : 3),
    });

    expect(tokenizer.estimateText('abc', 'm')).toBe(4);
    expect(tokenizer.estimateMessage({ role: 'user', content: 'abc' }, 'm')).toBe(7);
  });
});
