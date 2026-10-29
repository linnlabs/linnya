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
  const readable = contrastRatio(themed ?? DARK_TEXT, backdrop) >= 3;
  const text = readable ? themed ?? DARK_TEXT
    : contrastRatio(DARK_TEXT, backdrop) >= contrastRatio(LIGHT_TEXT, backdrop) ? DARK_TEXT : LIGHT_TEXT;
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

function contrastRatio(left: string, right: string): number {
  const [light, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
