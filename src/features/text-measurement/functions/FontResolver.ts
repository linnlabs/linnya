import type { TextMeasureStyle } from '../definitions/types.js';
import { pointsToPixels } from './UnitConverter.js';

function quoteFontFamily(fontFamily: string): string {
  if (fontFamily.includes('"') || fontFamily.includes(',')) {
    return fontFamily;
  }
  return /\s/.test(fontFamily) ? `"${fontFamily}"` : fontFamily;
}

export function resolveFontFamily(fontFamily: string | undefined, fallback = 'Arial'): string {
  const trimmed = fontFamily?.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed;
}

export function buildCanvasFontShorthand(style: TextMeasureStyle): string {
  const parts: string[] = [];
  if (style.italic) {
    parts.push('italic');
  }
  parts.push(style.bold ? '700' : '400');
  parts.push(`${Number(pointsToPixels(style.fontSizePt).toFixed(3))}px`);
  parts.push(quoteFontFamily(resolveFontFamily(style.fontFamily)));
  return parts.join(' ');
}
