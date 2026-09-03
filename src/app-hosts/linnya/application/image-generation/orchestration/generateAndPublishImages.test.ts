import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { generateAndPublishImages } from './generateAndPublishImages';

describe('generateAndPublishImages', () => {
  const createdDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(createdDirectories.splice(0).map(directory =>
      fsp.rm(directory, { recursive: true, force: true })
    ));
  });

  it('把 Provider-neutral 图片字节交给 Assets 建立媒体事实并发布', async () => {
    const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-image-use-case-'));
    createdDirectories.push(outputDir);
    const bytes = await sharp({
      create: {
        width: 32,
        height: 16,
        channels: 3,
        background: { r: 10, g: 80, b: 160 },
      },
    }).jpeg().toBuffer();

    const published = await generateAndPublishImages({
      modelId: 'image-model',
      prompt: '蓝色封面',
      size: '2048x2048',
      count: 1,
      outputDir,
      policy: { maxImageBytes: 1_000_000, maxImagePixels: 1_000_000 },
    }, {
      imageGeneration: {
        async generate() {
          return { model: 'provider-image-model', images: [{ bytes }] };
        },
      },
    });

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      mediaType: 'image/jpeg',
      width: 32,
      height: 16,
      originalPrompt: '蓝色封面',
      model: 'provider-image-model',
    });
    await expect(fsp.readFile(published[0].filePath)).resolves.toEqual(bytes);
  });
});
