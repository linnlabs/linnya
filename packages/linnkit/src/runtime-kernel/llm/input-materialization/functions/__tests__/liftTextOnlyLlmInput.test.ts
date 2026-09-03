import { describe, expect, it } from 'vitest';

import type { RuntimeResourceRef } from '../../../../../contracts';
import { MODEL_INPUT_ERROR_CODES } from '../../../input-capabilities';
import { liftTextOnlyLlmInput } from '../liftTextOnlyLlmInput';

const imageRef: RuntimeResourceRef = {
  id: 'attachment-1',
  kind: 'image',
  resourceId: 'asset-1',
  mediaType: 'image/png',
  byteLength: 128,
  width: 16,
  height: 8,
  sha256: 'a'.repeat(64),
};

describe('liftTextOnlyLlmInput', () => {
  it('提升纯文本消息并移除空的 durable attachments 字段', () => {
    const resolved = liftTextOnlyLlmInput('text-model', [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'hello', attachments: [] },
      { role: 'assistant', content: 'answer' },
    ]);

    expect(resolved).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'answer' },
    ]);
  });

  it('含图消息在 materializer 装配前明确失败', () => {
    expect(() => liftTextOnlyLlmInput('vision-model', [
      { role: 'user', content: '', attachments: [imageRef] },
    ])).toThrowError(expect.objectContaining({
      errorCode: MODEL_INPUT_ERROR_CODES.MATERIALIZATION_PENDING,
      recoverable: false,
      metadata: {
        active_model_id: 'vision-model',
        required_placements: ['user_image'],
        missing_conditions: ['materialization_pending'],
      },
    }));
  });
});
