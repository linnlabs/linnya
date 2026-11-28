import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderTitle, type ImageProcessingOutcome, type TitleRendering } from '..';

/** 宿主依赖 katex 自带的 OFL 字体：体积小、只有拉丁字母，正好用来验证缺字。 */
const FONT = new Uint8Array(readFileSync(createRequire(import.meta.url).resolve('katex/dist/fonts/KaTeX_Main-Regular.ttf')));

function value(outcome: ImageProcessingOutcome<TitleRendering>): TitleRendering {
  if (outcome.status === 'failed') throw new Error(`${outcome.code}: ${outcome.message}`);
  return outcome.value;
}

async function inkBounds(png: Uint8Array): Promise<{ left: number; top: number; right: number; bottom: number; width: number; height: number; ink: number; colors: Set<string> }> {
  const { data, info } = await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  let ink = 0;
  const colors = new Set<string>();
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const o = (y * info.width + x) * 4;
      if (data[o + 3] === 0) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      if (data[o + 3] === 255) {
        ink += 1;
        colors.add(`${data[o]},${data[o + 1]},${data[o + 2]}`);
      }
    }
  }
  return { left, top, right, bottom, width: info.width, height: info.height, ink, colors };
}

const BASE = { fontBytes: FONT, color: [176, 48, 42] as const, size: 120, direction: 'horizontal' as const, thicken: 0 };

describe('title：用字体文件渲染标题', () => {
  it('横排出透明 PNG 和只含路径的 SVG：裁到字形范围、颜色是指定色，并报字体里写的许可', async () => {
    const result = value(await renderTitle({ ...BASE, text: 'Bronze Age' }));
    expect(result.fontName).toBe('KaTeX_Main-Regular');
    expect(result.license).toContain('SIL Open Font License');
    expect(result.license).not.toMatch(/\n/u);
    expect(result.svg.text).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"><path d="[^"]+" fill="#b0302a"\/><\/svg>$/u);
    expect([result.image.width, result.image.height]).toEqual([result.svg.width, result.svg.height]);
    expect(result.svg.pathCommands).toBeGreaterThan(20);
    const bounds = await inkBounds(result.image.bytes);
    // 四周只留 2px 抗锯齿余量，字形贴着边
    expect(bounds.left).toBeLessThanOrEqual(3);
    expect(bounds.top).toBeLessThanOrEqual(3);
    expect(bounds.width - 1 - bounds.right).toBeLessThanOrEqual(3);
    expect(bounds.height - 1 - bounds.bottom).toBeLessThanOrEqual(3);
    expect(bounds.colors).toEqual(new Set(['176,48,42']));
  });

  it('竖排从上到下排；加粗让笔画变粗', async () => {
    const vertical = value(await renderTitle({ ...BASE, text: 'ABC', direction: 'vertical' }));
    expect(vertical.image.height).toBeGreaterThan(vertical.image.width * 2);
    const thick = value(await renderTitle({ ...BASE, text: 'ABC', direction: 'vertical', thicken: 0.04 }));
    expect(thick.svg.text).toContain('stroke-width="4.8"');
    expect((await inkBounds(thick.image.bytes)).ink).toBeGreaterThan((await inkBounds(vertical.image.bytes)).ink * 1.1);
  });

  it('缺字时列出缺的字，不出图；空白不算缺字', async () => {
    const outcome = await renderTitle({ ...BASE, text: '青铜 Age 青' });
    expect(outcome).toMatchObject({ status: 'failed', code: 'missing_glyphs' });
    expect(outcome.status === 'failed' && outcome.message).toContain('字体里没有这些字：青、铜；');
  });

  it('不是字体、标题为空、字号越界、渲染超过上限时各自报错', async () => {
    expect(await renderTitle({ ...BASE, fontBytes: new TextEncoder().encode('not a font'), text: 'Age' }))
      .toMatchObject({ status: 'failed', code: 'font_unreadable' });
    expect(await renderTitle({ ...BASE, text: '  ' })).toMatchObject({ status: 'failed', code: 'invalid_options' });
    expect(await renderTitle({ ...BASE, text: 'Age', size: 10 })).toMatchObject({ status: 'failed', code: 'invalid_options' });
    expect(await renderTitle({ ...BASE, text: 'Bronze Age Bronze Age', size: 2000 })).toMatchObject({ status: 'failed', code: 'invalid_options' });
  });
});
