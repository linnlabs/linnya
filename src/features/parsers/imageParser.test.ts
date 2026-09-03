import { describe, expect, it, vi } from 'vitest';
import type { TextGenerationPort } from 'src/domains/model-inference';
import { ImageParser } from './imageParser';

describe('ImageParser text generation boundary', () => {
  it('把图片二进制和业务提示词交给窄端口，并投影为图片描述 block', async () => {
    const generate = vi.fn<TextGenerationPort['generate']>().mockResolvedValue({
      text: ' 一张包含流程图的图片。 ',
      reasoning: '',
      finishReason: 'stop',
    });
    const parser = new ImageParser();

    const blocks = await parser.parseImageWithAi(
      new Uint8Array([1, 2, 3]),
      'doc-image',
      { generate },
      'vision-model'
    );

    expect(generate).toHaveBeenCalledWith({
      modelId: 'vision-model',
      messages: [
        { role: 'system', content: expect.any(String) },
        {
          role: 'user',
          content: [{
            type: 'image',
            mediaType: 'image/jpeg',
            bytes: new Uint8Array([1, 2, 3]),
          }],
        },
      ],
      maxOutputTokens: 4_000,
      temperature: 0.1,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      text: '一张包含流程图的图片。',
      type: 'image',
      metadata: {
        docId: 'doc-image',
        contentType: 'image_description',
        aiModel: 'vision-model',
      },
    });
  });
});
