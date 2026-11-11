import { describe, expect, it } from 'vitest';
import { applyImageAdjustToPixels, readImageAdjustInput, type ImageAdjust } from './imageAdjust';

function adjustPixel(rgb: [number, number, number], adjust: ImageAdjust): number[] {
  const data = new Uint8ClampedArray([...rgb, 200]);
  applyImageAdjustToPixels(data, adjust);
  return Array.from(data);
}

/** 期望值取自 PowerPoint 导出 PDF 里烘焙好的像素（2026-11-11）。 */
const POWERPOINT_SAMPLES: Array<[ImageAdjust, [number, number, number], [number, number, number]]> = [
  [{ grayscale: true }, [255, 0, 0], [54, 54, 54]],
  [{ grayscale: true }, [0, 255, 128], [192, 192, 192]],
  [{ duotone: ['#000000', '#D9C7A0'] }, [128, 128, 128], [108, 100, 81]],
  [{ duotone: ['#12233F', '#F3D98B'] }, [128, 128, 128], [132, 126, 102]],
  [{ duotone: ['#12233F', '#F3D98B'] }, [0, 255, 0], [179, 165, 118]],
  [{ brightness: 0.2 }, [0, 0, 0], [51, 51, 51]],
  [{ brightness: 0.2 }, [128, 255, 64], [179, 255, 115]],
  [{ contrast: 0.4 }, [64, 96, 192], [22, 75, 235]],
  [{ brightness: -0.2, contrast: -0.3 }, [255, 64, 32], [173, 40, 17]],
  [{ brightness: 0.2, contrast: 0.4 }, [32, 128, 160], [36, 196, 250]],
];

describe('图片调色公式与 PowerPoint 一致', () => {
  it.each(POWERPOINT_SAMPLES)('%j: %j → %j（±2 级），透明度不变', (adjust, input, expected) => {
    const [r, g, b, alpha] = adjustPixel(input, adjust);
    [r, g, b].forEach((value, channel) => expect(Math.abs(value - expected[channel])).toBeLessThanOrEqual(2));
    expect(alpha).toBe(200);
  });
});

describe('调色输入', () => {
  it('规范颜色，默认值不留字段', () => {
    expect(readImageAdjustInput({ duotone: ['#123', '#abcdef'], brightness: 0 }, 'Image.adjust'))
      .toEqual({ value: { duotone: ['#112233', '#ABCDEF'] } });
    expect(readImageAdjustInput({ grayscale: false }, 'Image.adjust')).toEqual({ value: undefined });
  });

  it.each([
    [{ grayscale: true, duotone: ['#000000', '#FFFFFF'] }, /只写一个/],
    [{ duotone: ['#000000'] }, /两个颜色/],
    [{ contrast: 1 }, /contrast/],
    [{ brightness: -1.2 }, /brightness/],
    [{ saturation: 0.5 }, /grayscale\?/],
  ])('%j 报错', (value, message) => {
    const result = readImageAdjustInput(value, 'Image.adjust');
    expect('error' in result && result.error).toMatch(message);
  });
});
