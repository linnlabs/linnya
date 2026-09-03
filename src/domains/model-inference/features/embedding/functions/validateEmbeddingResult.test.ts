import { describe, expect, it } from 'vitest';
import { validateEmbeddingResult } from './validateEmbeddingResult';

describe('validateEmbeddingResult', () => {
  it('accepts ordered finite vectors with a stable dimension', () => {
    expect(() => validateEmbeddingResult(['a', 'b'], [[1, 2], [3, 4]])).not.toThrow();
  });

  it('rejects count, dimension and finite-value contract violations', () => {
    expect(() => validateEmbeddingResult(['a'], [])).toThrow(/数量/);
    expect(() => validateEmbeddingResult(['a', 'b'], [[1], [1, 2]])).toThrow(/维度/);
    expect(() => validateEmbeddingResult(['a'], [[Number.NaN]])).toThrow(/非有限/);
  });
});
