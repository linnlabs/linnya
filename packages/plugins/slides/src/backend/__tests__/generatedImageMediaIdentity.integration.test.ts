import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeckSpec, SlideRenderModel } from '@plugin/slides/shared';
import { publishGeneratedImage } from 'src/domains/assets/features/generated-image-publication';
import { prefetchPptxImages } from '../engine/assets/imagePrefetch';
import { materializePresentationPage } from '../features/presentationPageRasterization';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => fsp.rm(root, {
    recursive: true,
    force: true,
  })));
});

describe('generate_image → Slides 媒体身份链路', () => {
  it('JPEG 生成结果以 .jpg 发布，Slides 内联和严格截图边界保持 image/jpeg', async () => {
    const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-generated-slides-'));
    tempRoots.push(outputDir);
    const jpegBytes = await sharp({
      create: {
        width: 32,
        height: 18,
        channels: 3,
        background: { r: 20, g: 90, b: 150 },
      },
    }).jpeg().toBuffer();
    const saved = await publishGeneratedImage({
      bytes: jpegBytes,
      outputDir,
      originalPrompt: '风电制造封面',
      model: 'provider-model',
      policy: { maxImageBytes: 1_000_000, maxImagePixels: 1_000_000 },
    });
    const deck: DeckSpec = {
      title: '媒体身份链路',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'freeform',
          background: { image: saved.filePath },
          elements: [],
        },
      }],
    };

    await prefetchPptxImages(deck);
    const background = deck.slides[0].spec.background?.image;
    if (!background || typeof background === 'string' || background.kind !== 'data_uri') {
      throw new Error('Slides 没有把生成图片内联为 data URI。');
    }
    expect(background.dataUri).toMatch(/^data:image\/jpeg;base64,/);

    const renderModel: SlideRenderModel = {
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'blank',
      background: { imageSrc: background.dataUri },
      elements: [],
    };
    const materialized = await materializePresentationPage({ slide: renderModel });
    expect(materialized.background.imageSrc).toBe(background.dataUri);
  });
});
