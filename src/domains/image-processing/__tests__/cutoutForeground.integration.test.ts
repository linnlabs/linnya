import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  cutoutForeground,
  type CutoutMethod,
  type EncodedImage,
  type ForegroundCutout,
  type ForegroundMaskPort,
  type ForegroundMaskResult,
  type ImageProcessingOutcome,
} from '..';

/**
 * 无缝背景纸上的器物：上亮下暗的背景渐变，中间一个深色圆角块，块里有一块和背景同样浅的高光。
 * 边缘抠图要去掉渐变背景，同时保住与边框不连通的高光。
 */
const PRODUCT_SHOT = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">',
  '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f4f2"/><stop offset="1" stop-color="#cfcfca"/></linearGradient></defs>',
  '<rect width="100%" height="100%" fill="url(#bg)"/>',
  '<rect x="120" y="80" width="160" height="140" rx="20" fill="#3a4a40"/>',
  '<rect x="160" y="110" width="40" height="30" fill="#eeeeec"/>',
  '</svg>',
].join('');

async function png(svg: string): Promise<Uint8Array> {
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

function value(outcome: ImageProcessingOutcome<ForegroundCutout>): ForegroundCutout {
  if (outcome.status === 'failed') throw new Error(`${outcome.code}: ${outcome.message}`);
  return outcome.value;
}

async function rgba(image: EncodedImage): Promise<{ data: Buffer; width: number }> {
  const { data, info } = await sharp(Buffer.from(image.bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width };
}

function pixel(image: { data: Buffer; width: number }, x: number, y: number): number[] {
  const o = (y * image.width + x) * 4;
  return [...image.data.subarray(o, o + 4)];
}

/** 本机没有系统前景遮罩：一旦被调用就说明 auto 没按可用性分流。 */
const UNAVAILABLE: ForegroundMaskPort = {
  available: false,
  mask: async () => { throw new Error('不可用时不应调用'); },
};

function fakeVision(answer: (jpeg: Uint8Array) => Promise<ForegroundMaskResult>): ForegroundMaskPort & { calls: number } {
  const port = { available: true, calls: 0, mask: async ({ jpeg }: { jpeg: Uint8Array }) => { port.calls += 1; return await answer(jpeg); } };
  return port;
}

/** 假的 Vision：给回同尺寸的 PNG，颜色全黑、透明度是一个圆。 */
async function circleMask(jpeg: Uint8Array): Promise<ForegroundMaskResult> {
  const { width = 0, height = 0 } = await sharp(Buffer.from(jpeg)).metadata();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><circle cx="200" cy="150" r="60" fill="#000"/></svg>`;
  return { status: 'ok', png: new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer()) };
}

async function cutout(bytes: Uint8Array, method: CutoutMethod, foregroundMask: ForegroundMaskPort) {
  return await cutoutForeground({ bytes, method, foregroundMask, signal: new AbortController().signal });
}

describe('cutout：去背并裁到主体', () => {
  it('没有系统前景遮罩时按边缘抠：渐变背景透明，主体内部和背景同色的高光保留，裁到主体', async () => {
    const result = value(await cutout(await png(PRODUCT_SHOT), 'auto', UNAVAILABLE));
    expect(result).toMatchObject({ engine: 'edge', visionFoundNothing: false, suspicious: false, borderForeground: 0 });
    expect(Math.abs(result.image.width - 160)).toBeLessThanOrEqual(6);
    expect(Math.abs(result.image.height - 140)).toBeLessThanOrEqual(6);
    const piece = await rgba(result.image);
    const x0 = Math.round((result.image.width - 160) / 2);
    const y0 = Math.round((result.image.height - 140) / 2);
    // 圆角外是背景，块身与高光都不透明，高光保持原色
    expect(pixel(piece, x0 + 1, y0 + 1)[3]).toBeLessThan(64);
    expect(pixel(piece, x0 + 80, y0 + 100)).toEqual([58, 74, 64, 255]);
    expect(pixel(piece, x0 + 60, y0 + 45)).toEqual([238, 238, 236, 255]);
    expect(result.check.format).toBe('jpeg');
    expect(result.check.width).toBeGreaterThan(400);
  });

  it('有系统前景遮罩时用它的透明度，颜色仍取自原图', async () => {
    const vision = fakeVision(circleMask);
    const result = value(await cutout(await png(PRODUCT_SHOT), 'auto', vision));
    expect(vision.calls).toBe(1);
    expect(result).toMatchObject({ engine: 'vision', visionFoundNothing: false });
    expect([result.image.width, result.image.height]).toEqual([120, 120]);
    // 圆心在原图 (200,150)，是深色块身，不是遮罩 PNG 里的黑色
    expect(pixel(await rgba(result.image), 60, 60)).toEqual([58, 74, 64, 255]);
  });

  it('auto 时 Vision 没找到前景，改用边缘抠并注明；指定 vision 时直接报错', async () => {
    const nothing = fakeVision(async () => ({ status: 'no_foreground' }));
    const fallback = value(await cutout(await png(PRODUCT_SHOT), 'auto', nothing));
    expect(fallback).toMatchObject({ engine: 'edge', visionFoundNothing: true });
    expect(await cutout(await png(PRODUCT_SHOT), 'vision', nothing)).toMatchObject({ status: 'failed', code: 'no_foreground' });
  });

  it('Vision 不可用、运行失败、遮罩尺寸对不上时报错，不偷偷换方法', async () => {
    const bytes = await png(PRODUCT_SHOT);
    expect(await cutout(bytes, 'vision', UNAVAILABLE)).toMatchObject({ status: 'failed', code: 'vision_unavailable' });
    const broken = fakeVision(async () => ({ status: 'failed', message: '系统前景遮罩运行失败' }));
    expect(await cutout(bytes, 'auto', broken)).toMatchObject({ status: 'failed', code: 'vision_failed', message: '系统前景遮罩运行失败' });
    const resized = fakeVision(async () => ({ status: 'ok', png: await png('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>') }));
    expect(await cutout(bytes, 'auto', resized)).toMatchObject({ status: 'failed', code: 'vision_failed' });
  });

  it('指定 edge 时即使有 Vision 也不调用；整张都是背景时报 no_foreground', async () => {
    const vision = fakeVision(circleMask);
    expect(value(await cutout(await png(PRODUCT_SHOT), 'edge', vision)).engine).toBe('edge');
    expect(vision.calls).toBe(0);
    const blank = await png('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="#e8e8e4"/></svg>');
    expect(await cutout(blank, 'edge', UNAVAILABLE)).toMatchObject({ status: 'failed', code: 'no_foreground' });
  });
});
