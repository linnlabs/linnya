import os from 'node:os';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createVisionForegroundMask } from '..';

/** 只有 macOS 14 及以上有前景实例遮罩；其他平台这里只确认适配器如实报告不可用。 */
const visionHost = process.platform === 'darwin' && Number(os.release().split('.')[0]) >= 23;

/** 浅色背景上一个带明暗的红球和一小块投影。 */
const BALL = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360">',
  '<defs><radialGradient id="b" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#ff8a7a"/><stop offset="0.6" stop-color="#c0302a"/><stop offset="1" stop-color="#5a1010"/></radialGradient>',
  '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2f2f0"/><stop offset="1" stop-color="#d8d8d4"/></linearGradient></defs>',
  '<rect width="100%" height="100%" fill="url(#bg)"/>',
  '<ellipse cx="240" cy="300" rx="110" ry="14" fill="#000" opacity="0.18"/>',
  '<circle cx="240" cy="190" r="110" fill="url(#b)"/>',
  '</svg>',
].join('');

describe('Vision 前景遮罩适配器', () => {
  it('按本机系统版本报告是否可用', () => {
    expect(createVisionForegroundMask().available).toBe(visionHost);
  });

  it.runIf(visionHost)('真实 Vision 给回同尺寸遮罩：主体不透明，背景和投影透明', async () => {
    const jpeg = new Uint8Array(await sharp(Buffer.from(BALL)).jpeg({ quality: 92 }).toBuffer());
    const result = await createVisionForegroundMask().mask({ jpeg, signal: new AbortController().signal });
    if (result.status !== 'ok') throw new Error(`Vision 没给出遮罩：${JSON.stringify(result)}`);
    const { data, info } = await sharp(Buffer.from(result.png)).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([480, 360]);
    expect(data[190 * 480 + 240]).toBe(255);
    expect(data[5 * 480 + 5]).toBe(0);
    expect(data[300 * 480 + 140]).toBe(0);
  });

  it.runIf(visionHost)('系统报错时返回 failed，错误里没有临时目录的路径', async () => {
    const result = await createVisionForegroundMask().mask({ jpeg: new TextEncoder().encode('not a jpeg'), signal: new AbortController().signal });
    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).not.toContain(os.tmpdir());
  });
});
