import { expect, it } from 'vitest';
import { readCanvasSwatchStyle } from '../functions/readCanvasSwatchStyle';

const colors = ['white', 'red', 'orange', 'yellow', 'green', 'cyan', 'purple'] as const;
const lightness = (hex: string) => {
  const value = Number.parseInt(hex.slice(1), 16);
  return Math.max(value >> 16, (value >> 8) & 255, value & 255);
};

it('浅色主题色块就是卡片纸色', () => {
  expect(readCanvasSwatchStyle('red', false).backgroundColor).toBe('#fdece7');
});
it('暗色主题色块用同色相中间色，七色互不相同且明显亮于暗色菜单底', () => {
  const fills = colors.map(color => readCanvasSwatchStyle(color, true).backgroundColor);
  expect(new Set(fills).size).toBe(colors.length);
  for (const fill of fills) expect(lightness(fill)).toBeGreaterThan(0x80);
  expect(readCanvasSwatchStyle('red', true).backgroundColor).toBe('#c68f80');
});
