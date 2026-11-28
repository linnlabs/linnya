import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { sliceSheet, type EncodedImage, type ImageProcessingOutcome, type SheetSlice } from '..';

/** 宫格图用 SVG 现场画：圆和斜线带抗锯齿的半透明边，正好检验去底后的边缘。 */
async function sheet(width: number, height: number, background: string, shapes: string): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${background}"/>${shapes}</svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

function value(outcome: ImageProcessingOutcome<SheetSlice>): SheetSlice {
  if (outcome.status === 'failed') throw new Error(`${outcome.code}: ${outcome.message}`);
  return outcome.value;
}

async function rgba(image: EncodedImage): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(Buffer.from(image.bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function pixel(image: { data: Buffer; width: number }, x: number, y: number): number[] {
  const o = (y * image.width + x) * 4;
  return [...image.data.subarray(o, o + 4)];
}

/** 半透明边上最大的品红超出量（min(R,B) − G）：去底不干净时这里会露出品红边。 */
function maxMagentaFringe(image: { data: Buffer }): number {
  let max = -255;
  for (let o = 0; o < image.data.length; o += 4) {
    const alpha = image.data[o + 3];
    if (alpha < 32 || alpha > 224) continue;
    max = Math.max(max, Math.min(image.data[o], image.data[o + 2]) - image.data[o + 1]);
  }
  return max;
}

const MAGENTA_SHEET = [
  // 第一行：蓝圆，右边贴着一滴飞溅出的小水珠；绿色元素（品红底的用处：绿色主体不会被抠掉）
  '<circle cx="100" cy="100" r="60" fill="#285ac8"/>',
  '<circle cx="172" cy="100" r="8" fill="#285ac8"/>',
  '<rect x="300" y="50" width="120" height="100" fill="#2a9d3a"/>',
  // 第二行：细长的斜线（像剑，像素很少但不是碎屑）和红方块
  '<line x1="80" y1="250" x2="200" y2="370" stroke="#d0d4dc" stroke-width="6"/>',
  '<rect x="330" y="260" width="120" height="120" fill="#c03030"/>',
].join('');

describe('slice：纯色底宫格切成透明小图', () => {
  it('品红底按阅读顺序切出各元素，小水珠并进旁边的元素，边上不留品红，另出检查图', async () => {
    const result = value(await sliceSheet({ bytes: await sheet(600, 400, '#ff00ff', MAGENTA_SHEET), key: 'auto' }));
    expect(result.mode).toBe('magenta');
    expect(result.background).toEqual([255, 0, 255]);
    expect(result.pieces).toHaveLength(4);
    const [circle, green, line, red] = await Promise.all(result.pieces.map(rgba));
    // 蓝圆 40–160 加上水珠到 180
    expect(circle.width).toBeGreaterThanOrEqual(138);
    expect(circle.width).toBeLessThanOrEqual(142);
    expect(pixel(circle, 60, circle.height >> 1)).toEqual([40, 90, 200, 255]);
    expect(pixel(circle, 2, 2)[3]).toBe(0);
    expect(pixel(green, green.width >> 1, green.height >> 1)).toEqual([42, 157, 58, 255]);
    expect(line.width).toBeGreaterThanOrEqual(120);
    expect(pixel(red, red.width >> 1, red.height >> 1)).toEqual([192, 48, 48, 255]);
    for (const piece of [circle, line]) expect(maxMagentaFringe(piece)).toBeLessThanOrEqual(40);
    expect(result.check.format).toBe('jpeg');
  });

  it('元素粘连时按格子切开，空格子不出图', async () => {
    // 2×2 格：横条跨过第一行两格，左下一个圆，右下空着
    const bytes = await sheet(400, 400, '#ff00ff', [
      '<rect x="40" y="80" width="320" height="40" fill="#285ac8"/>',
      '<circle cx="100" cy="300" r="50" fill="#c03030"/>',
    ].join(''));
    expect(value(await sliceSheet({ bytes, key: 'auto' })).pieces).toHaveLength(2);
    const byGrid = value(await sliceSheet({ bytes, key: 'auto', grid: { columns: 2, rows: 2 } }));
    expect(byGrid.pieces.map(piece => piece.width)).toEqual([160, 160, 100]);
  });

  it('白底从边框去底，元素内部的白色保留不透明', async () => {
    const bytes = await sheet(300, 300, '#ffffff', '<circle cx="150" cy="150" r="80" fill="#ffffff" stroke="#333333" stroke-width="12"/>');
    const result = value(await sliceSheet({ bytes, key: 'auto' }));
    expect(result.mode).toBe('flood');
    expect(result.pieces).toHaveLength(1);
    const ring = await rgba(result.pieces[0]);
    expect(pixel(ring, ring.width >> 1, ring.height >> 1)).toEqual([255, 255, 255, 255]);
    expect(pixel(ring, 1, 1)[3]).toBe(0);
  });

  it('画出来的棋盘格不是透明底，拒绝而不是硬切', async () => {
    const squares = Array.from({ length: 400 }, (_, i) => {
      const x = (i % 20) * 16;
      const y = Math.floor(i / 20) * 16;
      return (i % 20 + Math.floor(i / 20)) % 2 === 0 ? `<rect x="${x}" y="${y}" width="16" height="16" fill="#cccccc"/>` : '';
    }).join('');
    const outcome = await sliceSheet({ bytes: await sheet(320, 320, '#ffffff', `${squares}<circle cx="160" cy="160" r="60" fill="#285ac8"/>`), key: 'auto' });
    expect(outcome).toMatchObject({ status: 'failed', code: 'background_not_uniform' });
  });

  it('指定的键色与实测底色不符、空图、块数超限时各自报错', async () => {
    const magenta = await sheet(600, 400, '#ff00ff', MAGENTA_SHEET);
    expect(await sliceSheet({ bytes: magenta, key: 'green' })).toMatchObject({ status: 'failed', code: 'invalid_options' });
    expect(await sliceSheet({ bytes: await sheet(200, 200, '#ff00ff', ''), key: 'auto' })).toMatchObject({ status: 'failed', code: 'no_pieces' });
    const dots = Array.from({ length: 81 }, (_, i) => `<circle cx="${50 + (i % 9) * 100}" cy="${50 + Math.floor(i / 9) * 100}" r="10" fill="#285ac8"/>`).join('');
    expect(await sliceSheet({ bytes: await sheet(900, 900, '#ff00ff', dots), key: 'auto' })).toMatchObject({ status: 'failed', code: 'too_many_pieces' });
  });
});
