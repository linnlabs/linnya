import { describe, expect, it } from 'vitest';

import { getAiRecognitionAttemptTimeoutMs } from './VisionRecognitionStrategy';

describe('getAiRecognitionAttemptTimeoutMs', () => {
  it('模型声明 attempt_timeout_ms 时使用配置值', () => {
    expect(
      getAiRecognitionAttemptTimeoutMs({
        modelId: 'ocr-model',
        displayName: 'OCR Model',
        mode: 'document_upload',
        supportsAbortSignal: true,
        attemptTimeoutMs: 300_000,
      })
    ).toBe(300_000);
  });

  it('通用视觉模型使用默认 120 秒', () => {
    expect(getAiRecognitionAttemptTimeoutMs()).toBe(120_000);
  });
});
