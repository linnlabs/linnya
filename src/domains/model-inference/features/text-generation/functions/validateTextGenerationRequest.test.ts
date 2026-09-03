import { describe, expect, it } from 'vitest';

import { validateTextGenerationRequest } from './validateTextGenerationRequest';

describe('validateTextGenerationRequest', () => {
  it('接受文本与图片组成的真实视觉请求', () => {
    expect(() => validateTextGenerationRequest({
      modelId: 'vision-model',
      messages: [
        { role: 'system', content: 'Describe the image.' },
        {
          role: 'user',
          content: [{ type: 'image', mediaType: 'image/jpeg', bytes: new Uint8Array([1, 2]) }],
        },
      ],
      maxOutputTokens: 4000,
    })).not.toThrow();
  });

  it('拒绝空图片和非法输出上限', () => {
    expect(() => validateTextGenerationRequest({
      modelId: 'vision-model',
      messages: [{
        role: 'user',
        content: [{ type: 'image', mediaType: 'image/jpeg', bytes: new Uint8Array() }],
      }],
      maxOutputTokens: 0,
    })).toThrow('User image block 不能为空');
  });
});
