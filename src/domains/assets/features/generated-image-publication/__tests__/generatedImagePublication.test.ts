import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GeneratedImagePublicationError,
  publishGeneratedImage,
} from '../index';

const TEST_POLICY = Object.freeze({
  maxImageBytes: 1_000_000,
  maxImagePixels: 1_000_000,
});

describe('generated image publication', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-generated-image-'));
  });

  afterEach(async () => {
    await fsp.rm(outputDir, { recursive: true, force: true });
  });

  async function createImage(format: 'jpeg' | 'png' | 'webp'): Promise<Buffer> {
    const image = sharp({
      create: {
        width: 24,
        height: 12,
        channels: 3,
        background: { r: 15, g: 120, b: 210 },
      },
    });
    return image[format]().toBuffer();
  }

  it('JPEG 字节保持原始编码，并发布扩展名、MIME 与元数据一致的文件', async () => {
    const jpegBytes = await createImage('jpeg');
    const saved = await publishGeneratedImage({
      bytes: jpegBytes,
      outputDir,
      originalPrompt: '风机工厂封面图',
      model: 'provider-model',
      policy: TEST_POLICY,
    });

    expect(saved).toMatchObject({
      mediaType: 'image/jpeg',
      byteLength: jpegBytes.byteLength,
      width: 24,
      height: 12,
      originalPrompt: '风机工厂封面图',
      model: 'provider-model',
    });
    expect(saved.fileName).toMatch(/^generated_image_.+_[0-9a-f-]+\.jpg$/);
    await expect(fsp.readFile(saved.filePath)).resolves.toEqual(jpegBytes);

    const metadataPath = path.join(
      outputDir,
      `${path.basename(saved.fileName, '.jpg')}_metadata.json`,
    );
    const metadata = JSON.parse(await fsp.readFile(metadataPath, 'utf8')) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      filePath: saved.filePath,
      fileName: saved.fileName,
      mediaType: 'image/jpeg',
      byteLength: jpegBytes.byteLength,
      width: 24,
      height: 12,
      sha256: saved.sha256,
    });
  });

  it('WebP 字节发布为 .webp，且同一毫秒的多张结果不会互相覆盖', async () => {
    const webpBytes = await createImage('webp');

    const [first, second] = await Promise.all([
      publishGeneratedImage({
        bytes: webpBytes,
        outputDir,
        originalPrompt: '第一张',
        model: 'provider-model',
        policy: TEST_POLICY,
      }),
      publishGeneratedImage({
        bytes: webpBytes,
        outputDir,
        originalPrompt: '第二张',
        model: 'provider-model',
        policy: TEST_POLICY,
      }),
    ]);

    expect(first.mediaType).toBe('image/webp');
    expect(first.fileName).toMatch(/\.webp$/);
    expect(second.fileName).toMatch(/\.webp$/);
    expect(second.filePath).not.toBe(first.filePath);
    await expect(fsp.readFile(first.filePath)).resolves.toEqual(webpBytes);
    await expect(fsp.readFile(second.filePath)).resolves.toEqual(webpBytes);
  });

  it('无效或超限字节在任何文件对外发布前失败', async () => {
    await expect(publishGeneratedImage({
      bytes: Buffer.from('not-an-image'),
      outputDir,
      originalPrompt: '无效图片',
      model: 'provider-model',
      policy: TEST_POLICY,
    })).rejects.toMatchObject({ code: 'unsupported_image_format' });

    await expect(publishGeneratedImage({
      bytes: Buffer.alloc(17),
      outputDir,
      originalPrompt: '超限图片',
      model: 'provider-model',
      policy: { maxImageBytes: 16, maxImagePixels: 1_000_000 },
    })).rejects.toBeInstanceOf(GeneratedImagePublicationError);

    await expect(fsp.readdir(outputDir)).resolves.toEqual([]);
  });
});
