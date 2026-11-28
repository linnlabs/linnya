import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  convertInkToAlpha,
  createTexture,
  frostImageRegion,
  measureImageTrim,
  overlayImageGrid,
  warpImageToQuad,
  type EncodedImage,
  type ImageProcessingOutcome,
} from '..';

/** 测试用图都用 sharp 现场生成，每张只放验证所需的结构。 */
async function canvas(width: number, height: number, background: string, blocks: readonly { left: number; top: number; width: number; height: number; color: string }[] = []): Promise<Uint8Array> {
  const layers = await Promise.all(blocks.map(async block => ({
    input: await sharp({ create: { width: block.width, height: block.height, channels: 3, background: block.color } }).png().toBuffer(),
    left: block.left, top: block.top,
  })));
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background } }).composite(layers).jpeg({ quality: 95 }).toBuffer());
}

function value<T>(outcome: ImageProcessingOutcome<T>): T {
  if (outcome.status === 'failed') throw new Error(`${outcome.code}: ${outcome.message}`);
  return outcome.value;
}

async function rgba(image: EncodedImage | Uint8Array): Promise<{ data: Buffer; width: number; height: number }> {
  const bytes = image instanceof Uint8Array ? image : image.bytes;
  const { data, info } = await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function pixel(image: { data: Buffer; width: number }, x: number, y: number): number[] {
  const o = (y * image.width + x) * 4;
  return [...image.data.subarray(o, o + 4)];
}

describe('trim：量出纯色边', () => {
  it('给出各边要裁的比例；另存时尺寸就是裁剩的部分', async () => {
    // 400×200 白底，中间 240×120 的内容，四边各留 20%
    const bytes = await canvas(400, 200, '#ffffff', [{ left: 80, top: 40, width: 240, height: 120, color: '#3366aa' }]);
    const measured = value(await measureImageTrim({ bytes, tolerance: 16, save: true }));
    for (const side of ['top', 'right', 'bottom', 'left'] as const) expect(measured.crop[side]).toBeCloseTo(0.2, 2);
    expect(measured.image).toMatchObject({ format: 'jpeg' });
    expect(measured.image?.width).toBeGreaterThanOrEqual(238);
    expect(measured.image?.width).toBeLessThanOrEqual(242);
  });

  it('没有边可裁时四边都是 0，不报错；不另存就不出图', async () => {
    const measured = value(await measureImageTrim({ bytes: await canvas(120, 80, '#ffffff'), tolerance: 16, save: false }));
    expect(measured.crop).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(measured.image).toBeUndefined();
  });

  it('不是图片时报 image_unreadable', async () => {
    const outcome = await measureImageTrim({ bytes: new TextEncoder().encode('not an image'), tolerance: 16, save: false });
    expect(outcome).toMatchObject({ status: 'failed', code: 'image_unreadable' });
  });
});

describe('ink：白纸墨迹转单色加透明', () => {
  it('泛黄的纸变全透明，墨迹不透明并换成墨色，裁到有墨的范围', async () => {
    const bytes = await canvas(300, 200, '#ebe1c8', [{ left: 100, top: 50, width: 60, height: 80, color: '#222222' }]);
    const out = value(await convertInkToAlpha({ bytes, ink: [180, 30, 30] }));
    expect(out.format).toBe('png');
    // 裁到墨块（JPEG 边缘允许几像素出入）
    expect(Math.abs(out.width - 60)).toBeLessThanOrEqual(4);
    expect(Math.abs(out.height - 80)).toBeLessThanOrEqual(4);
    const decoded = await rgba(out);
    expect(pixel(decoded, out.width >> 1, out.height >> 1)).toEqual([180, 30, 30, 255]);
  });

  it('照片或深色底拒绝，而不是交回一张半透明的灰图', async () => {
    const outcome = await convertInkToAlpha({ bytes: await canvas(200, 200, '#303844'), ink: [0, 0, 0] });
    expect(outcome).toMatchObject({ status: 'failed', code: 'background_not_light' });
  });

  it('已经是透明底的浅色字保留原透明度，只换颜色', async () => {
    const glyph = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 245, g: 240, b: 230, alpha: 1 } } }).png().toBuffer();
    const bytes = new Uint8Array(await sharp({ create: { width: 120, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: glyph, left: 40, top: 40 }]).png().toBuffer());
    const out = value(await convertInkToAlpha({ bytes, ink: [20, 20, 20] }));
    expect([out.width, out.height]).toEqual([40, 40]);
    expect(pixel(await rgba(out), 20, 20)).toEqual([20, 20, 20, 255]);
  });
});

describe('frost：预先模糊卡片区域', () => {
  async function stripes(): Promise<Uint8Array> {
    // 黑白竖条纹：模糊后变成灰，区域外保持黑白
    const blocks = Array.from({ length: 20 }, (_, i) => ({ left: i * 20, top: 0, width: 10, height: 200, color: '#000000' }));
    return await canvas(400, 200, '#ffffff', blocks);
  }

  it('区域里变成均匀的灰，区域外不变；有圆角时角上仍是原图', async () => {
    const source = await rgba(await stripes());
    const out = value(await frostImageRegion({ bytes: await stripes(), region: { left: 0.5, top: 0.25, width: 0.4, height: 0.5 }, blur: 12, radius: 0.3 }));
    expect(out.format).toBe('jpeg');
    const frosted = await rgba(out);
    // 区域中心：条纹被抹平，接近中灰
    const center = pixel(frosted, 280, 100)[0];
    expect(center).toBeGreaterThan(90);
    expect(center).toBeLessThan(170);
    // 区域外：与原图一致（JPEG 重压缩允许小误差）
    for (const x of [5, 15, 105]) expect(Math.abs(pixel(frosted, x, 100)[0] - pixel(source, x, 100)[0])).toBeLessThan(40);
    // 区域左上角在圆角外，应保持原图的条纹而不是灰
    expect(Math.abs(pixel(frosted, 201, 51)[0] - pixel(source, 201, 51)[0])).toBeLessThan(40);
  });

  it('给了页面比例时先居中裁成该比例，区域按裁后的图算', async () => {
    // 400×200 的条纹裁成 1:1，留下中间 200×200；区域取右半边
    const out = value(await frostImageRegion({ bytes: await stripes(), region: { left: 0.5, top: 0, width: 0.5, height: 1 }, blur: 12, radius: 0, aspect: 1 }));
    expect([out.width, out.height]).toEqual([200, 200]);
    const frosted = await rgba(out);
    const leftHalf = Array.from({ length: 20 }, (_, x) => pixel(frosted, 40 + x, 100)[0]);
    expect(Math.max(...leftHalf) - Math.min(...leftHalf)).toBeGreaterThan(150);
    const rightHalf = Array.from({ length: 20 }, (_, x) => pixel(frosted, 140 + x, 100)[0]);
    expect(Math.max(...rightHalf) - Math.min(...rightHalf)).toBeLessThan(60);
  });

  it('区域越界时报 invalid_options', async () => {
    const outcome = await frostImageRegion({ bytes: await stripes(), region: { left: 0.8, top: 0, width: 0.4, height: 1 }, blur: 12, radius: 0 });
    expect(outcome).toMatchObject({ status: 'failed', code: 'invalid_options' });
  });
});

describe('perspective：投影进四边形', () => {
  it('四边形内是原图，四边形外透明', async () => {
    const bytes = await canvas(200, 100, '#cc2222');
    const out = value(await warpImageToQuad({ bytes, quad: [[0.1, 0.2], [0.9, 0], [0.9, 1], [0.1, 0.8]], width: 400, height: 300 }));
    expect([out.format, out.width, out.height]).toEqual(['png', 400, 300]);
    const decoded = await rgba(out);
    const [r, g, b, a] = pixel(decoded, 200, 150);
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(180);
    expect(g + b).toBeLessThan(100);
    // 左上角在四边形外
    expect(pixel(decoded, 5, 5)[3]).toBe(0);
    // 右上角那条斜边外侧（x=60 处上边约在 y=56）
    expect(pixel(decoded, 60, 20)[3]).toBe(0);
  });

  it('角的顺序写反（四边形自交）时报 invalid_options', async () => {
    const outcome = await warpImageToQuad({ bytes: await canvas(50, 50, '#ffffff'), quad: [[0.9, 0], [0.1, 0.2], [0.9, 1], [0.1, 0.8]] });
    expect(outcome).toMatchObject({ status: 'failed', code: 'invalid_options' });
  });
});

describe('grid 与 texture', () => {
  it('网格图缩到长边 1600，等分数越界时拒绝', async () => {
    const bytes = await canvas(3200, 1600, '#ffffff');
    const out = value(await overlayImageGrid({ bytes, divisions: 10 }));
    expect([out.format, out.width, out.height]).toEqual(['jpeg', 1600, 800]);
    expect(await overlayImageGrid({ bytes, divisions: 40 })).toMatchObject({ status: 'failed', code: 'invalid_options' });
  });

  it('纸纹不透明、出 JPEG；颗粒是透明叠加层、出 PNG', async () => {
    const paper = value(await createTexture({ kind: 'paper', width: 320, height: 180 }));
    expect([paper.format, paper.width, paper.height]).toEqual(['jpeg', 320, 180]);
    const grain = value(await createTexture({ kind: 'grain', width: 200, height: 100 }));
    expect(grain.format).toBe('png');
    const decoded = await rgba(grain);
    const alphas = Array.from({ length: 200 }, (_, i) => pixel(decoded, i, 50)[3]);
    expect(Math.min(...alphas)).toBeLessThan(40);
    expect(Math.max(...alphas)).toBeGreaterThan(40);
    expect(await createTexture({ kind: 'paper', width: 8, height: 100 })).toMatchObject({ status: 'failed', code: 'invalid_options' });
  });
});
