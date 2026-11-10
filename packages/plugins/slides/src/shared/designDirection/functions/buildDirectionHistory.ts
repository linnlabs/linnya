import { isHueWithinArc, parseColor, rgbToOklch } from '@linnya/color-core';
import { HUE_BINS, VISIBLE_HUE_MIN_CHROMA } from '../pool/axes';
import type { DirectionHistory } from './drawDirection';

/** 由近到远的方向使用记录 → 抽取用的历史；强调色归到 12 档主色相，看不出色相的不计。 */
export function buildDirectionHistory(
  uses: readonly { readonly cardId: string; readonly accent?: string }[],
): DirectionHistory {
  const hueBins: number[] = [];
  for (const use of uses) {
    const bin = use.accent ? hueBinOf(use.accent) : null;
    if (bin != null) hueBins.push(bin);
  }
  return { cardIds: uses.map((use) => use.cardId), hueBins };
}

function hueBinOf(hex: string): number | null {
  const parsed = parseColor(hex);
  if (!parsed) return null;
  const color = rgbToOklch(parsed.channels);
  if (color.c < VISIBLE_HUE_MIN_CHROMA) return null;
  return HUE_BINS.find((entry) => isHueWithinArc(color.h, entry.from, entry.to))?.bin ?? null;
}
