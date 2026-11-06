import type { DirectionHistory } from './drawDirection';

/** 由近到远的方向使用记录 → 抽取用的历史；强调色换算成 30° 色相区间，中性色不计。 */
export function buildDirectionHistory(
  uses: readonly { readonly cardId: string; readonly accent?: string }[],
): DirectionHistory {
  const hueBins: number[] = [];
  for (const use of uses) {
    const hue = use.accent ? chromaticHue(use.accent) : null;
    if (hue != null) hueBins.push(Math.floor(hue / 30) % 12);
  }
  return { cardIds: uses.map((use) => use.cardId), hueBins };
}

function chromaticHue(hex: string): number | null {
  const match = /^#?([0-9a-f]{6})$/iu.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return null;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.1 || lightness < 0.08 || lightness > 0.92) return null;
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
}
