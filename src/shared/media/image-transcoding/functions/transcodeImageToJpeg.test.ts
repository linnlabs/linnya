import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { transcodeImageToJpeg } from './transcodeImageToJpeg';

const options = {
  quality: 100,
  chromaSubsampling: '4:4:4' as const,
  maxInputPixels: 100,
};

describe('transcodeImageToJpeg', () => {
  it('把已经不透明的页面像素编码为真实 JPEG', async () => {
    const png = await sharp(Buffer.from([
      255, 0, 0, 255,
      0, 0, 255, 255,
    ]), {
      raw: { width: 2, height: 1, channels: 4 },
    }).png().toBuffer();

    const jpeg = await transcodeImageToJpeg({ bytes: png, options });
    const metadata = await sharp(jpeg).metadata();
    const pixels = await sharp(jpeg).raw().toBuffer();

    expect([...jpeg.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(metadata).toMatchObject({ format: 'jpeg', width: 2, height: 1, hasAlpha: false });
    expect(pixels[0]).toBeGreaterThan(245);
    expect(pixels[1]).toBeLessThan(12);
    expect(pixels[2]).toBeLessThan(12);
    expect(pixels[3]).toBeLessThan(12);
    expect(pixels[4]).toBeLessThan(12);
    expect(pixels[5]).toBeGreaterThan(245);
  });

  it('拒绝用隐式底色掩盖页面透明像素', async () => {
    const png = await sharp(Buffer.from([
      255, 0, 0, 255,
      0, 0, 255, 0,
    ]), {
      raw: { width: 2, height: 1, channels: 4 },
    }).png().toBuffer();

    await expect(transcodeImageToJpeg({ bytes: png, options })).rejects.toMatchObject({
      code: 'invalid_image',
      message: 'JPEG 转码只接受已经完成背景合成的不透明图片',
    });
  });

  it('在调用图片库前拒绝无效的编码参数', async () => {
    await expect(transcodeImageToJpeg({
      bytes: new Uint8Array([1]),
      options: { ...options, quality: 0 },
    })).rejects.toMatchObject({
      code: 'invalid_options',
    });
  });

  it('沿用显式输入像素预算拒绝超大图片', async () => {
    const png = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    }).png().toBuffer();

    await expect(transcodeImageToJpeg({
      bytes: png,
      options: { ...options, maxInputPixels: 3 },
    })).rejects.toMatchObject({
      code: 'invalid_image',
    });
  });
});
