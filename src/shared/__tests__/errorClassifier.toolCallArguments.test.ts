import { describe, expect, it } from 'vitest';

import { ErrorCategory, ErrorClassifier } from '../../shared/errorClassifier';

describe('ErrorClassifier - malformed streamed tool arguments', () => {
  it('应将 invalid tool_call.arguments 视为可重试的模型输出损坏', () => {
    const err = new Error(
      '[LlmCaller] Stream ended with invalid tool_call.arguments for ppt_plan (call_123). length=2943 head={"title":"Deck"} tail=...'
    );

    const classification = ErrorClassifier.classify(err);

    expect(classification.category).toBe(ErrorCategory.RETRYABLE);
    expect(classification.reason).toBe('模型输出损坏: invalid tool_call.arguments');
  });
});
