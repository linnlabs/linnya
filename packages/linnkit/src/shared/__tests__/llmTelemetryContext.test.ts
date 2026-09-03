import { describe, expect, it } from 'vitest';
import { normalizedUsageFromCanonical } from '../llmTelemetryContext';

describe('llmTelemetryContext usage normalization', () => {
  it('keeps optional canonical fields unknown when provider did not report them', () => {
    const normalized = normalizedUsageFromCanonical({
      inputTokens: 3,
      outputTokens: 2,
      source: 'test-fixture',
      confidence: 'actual',
    });

    expect(normalized).toEqual({
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
      canonicalUsage: {
        inputTokens: 3,
        outputTokens: 2,
        source: 'test-fixture',
        confidence: 'actual',
      },
    });
  });
});
