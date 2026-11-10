import { contrastRatio, parseColor } from '@linnya/color-core';
import type { SlideBackgroundModel } from '../../../types/render';

export interface InsertionPalette {
  readonly text: string;
  readonly fill: string;
}

const DARK_TEXT = '#111827';
const LIGHT_TEXT = '#FFFFFF';
const FALLBACK_FILL = '#2563EB';
const HEX_COLOR = /^#[0-9A-F]{6}$/u;

/** 新对象沿用文稿主题；主题文字色在当前页背景上看不清时，改用深色或白色。 */
export function resolveInsertionPalette(
  themeColors: Readonly<Record<string, string>> | undefined,
  background: SlideBackgroundModel | undefined,
): InsertionPalette {
  const backdrop = readBackdropColor(background);
  const themed = canonicalHex(themeColors?.text);
  const readable = hexContrast(themed ?? DARK_TEXT, backdrop) >= 3;
  const text = readable ? themed ?? DARK_TEXT
    : hexContrast(DARK_TEXT, backdrop) >= hexContrast(LIGHT_TEXT, backdrop) ? DARK_TEXT : LIGHT_TEXT;
  return { text, fill: canonicalHex(themeColors?.accent1) ?? FALLBACK_FILL };
}

function readBackdropColor(background: SlideBackgroundModel | undefined): string {
  const paint = background?.paint;
  if (paint?.type === 'solid') return canonicalHex(paint.color) ?? LIGHT_TEXT;
  if (paint?.type === 'linear' || paint?.type === 'radial') return canonicalHex(paint.stops[0]?.color) ?? LIGHT_TEXT;
  return LIGHT_TEXT;
}

function canonicalHex(value: string | undefined): string | undefined {
  const color = value?.trim().toUpperCase();
  return color && HEX_COLOR.test(color) ? color : undefined;
}

/** 两个参数都已是 canonicalHex 或内置常量，一定能解析；解析不了时按不可读处理。 */
function hexContrast(left: string, right: string): number {
  const a = parseColor(left);
  const b = parseColor(right);
  return a && b ? contrastRatio(a.channels, b.channels) : 1;
}
