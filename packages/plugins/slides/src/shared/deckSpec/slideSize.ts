export type SlideLayoutPreset = '16x9' | '16x10' | '4x3';

export interface CustomSlideLayout {
  readonly width: number;
  readonly height: number;
  readonly unit: 'in';
}

export type SlideLayout = SlideLayoutPreset | CustomSlideLayout;

export interface SlideSizeInches {
  readonly width: number;
  readonly height: number;
}

export interface SlideSizeBoxInches {
  readonly w: number;
  readonly h: number;
}

export interface RenderSlideSizeInches extends SlideSizeInches {
  readonly unit: 'in';
}

export interface SlideSizeEmu {
  readonly cx: number;
  readonly cy: number;
}

export type SlideLayoutNormalizationResult =
  | { readonly value: SlideLayout }
  | { readonly error: string };

export const DEFAULT_SLIDE_LAYOUT: SlideLayoutPreset = '16x9';
export const SLIDE_LAYOUT_MIN_INCHES = 1;
export const SLIDE_LAYOUT_MAX_INCHES = 56;
export const EMU_PER_INCH = 914_400;

export const SLIDE_SIZES_INCHES: Readonly<Record<SlideLayoutPreset, SlideSizeInches>> = {
  '16x9': { width: 10, height: 5.625 },
  '16x10': { width: 10, height: 6.25 },
  '4x3': { width: 10, height: 7.5 },
} as const;

export function resolveSlideSizeInches(
  layout: SlideLayout | undefined,
): SlideSizeInches {
  const normalized = requireNormalizedSlideLayout(layout ?? DEFAULT_SLIDE_LAYOUT);
  if (typeof normalized === 'string') return SLIDE_SIZES_INCHES[normalized];
  return { width: normalized.width, height: normalized.height };
}

export function resolveSlideSizeBoxInches(
  layout: SlideLayout | undefined,
): SlideSizeBoxInches {
  return toSlideSizeBox(resolveSlideSizeInches(layout));
}

/** 动态输入、持久化与 worker codec 共用的唯一 layout admission。 */
export function normalizeSlideLayout(input: unknown): SlideLayoutNormalizationResult {
  if (isSlideLayoutPreset(input)) return { value: input };
  if (!isRecord(input)) return { error: layoutErrorMessage() };
  if (Object.keys(input).some((key) => key !== 'width' && key !== 'height' && key !== 'unit')) {
    return { error: 'layout 自定义尺寸只能包含 width、height 和 unit。' };
  }
  if (input.unit !== 'in') return { error: 'layout.unit 必须是 "in"。' };
  const width = normalizeDimension(input.width, 'width');
  if ('error' in width) return width;
  const height = normalizeDimension(input.height, 'height');
  if ('error' in height) return height;
  return {
    value: {
      width: width.value,
      height: height.value,
      unit: 'in',
    },
  };
}

export function isSlideLayout(input: unknown): input is SlideLayout {
  return 'value' in normalizeSlideLayout(input);
}

export function requireNormalizedSlideLayout(input: unknown): SlideLayout {
  const result = normalizeSlideLayout(input);
  if ('error' in result) throw new RangeError(result.error);
  return result.value;
}

/** SQLite 摘要列等字符串索引使用该 key；完整尺寸仍以 DeckSpec 为真相。 */
export function createSlideLayoutKey(layout: SlideLayout | undefined): string {
  const normalized = requireNormalizedSlideLayout(layout ?? DEFAULT_SLIDE_LAYOUT);
  if (typeof normalized === 'string') return normalized;
  const size = toSlideSizeEmu(normalized);
  return `custom:${size.cx}x${size.cy}`;
}

/** PptxGenJS custom layout name 只属于 adapter，不进入 DeckSpec。 */
export function createPptxCustomLayoutName(layout: CustomSlideLayout): string {
  const size = toSlideSizeEmu(layout);
  return `LINNYA_${size.cx}_${size.cy}`;
}

export function toSlideSizeEmu(size: SlideSizeInches): SlideSizeEmu {
  return {
    cx: Math.round(size.width * EMU_PER_INCH),
    cy: Math.round(size.height * EMU_PER_INCH),
  };
}

export function toSlideSizeBox(size: SlideSizeInches): SlideSizeBoxInches {
  return { w: size.width, h: size.height };
}

export function toRenderSlideSize(size: SlideSizeInches): RenderSlideSizeInches {
  return { width: size.width, height: size.height, unit: 'in' };
}

function isSlideLayoutPreset(input: unknown): input is SlideLayoutPreset {
  return input === '16x9' || input === '16x10' || input === '4x3';
}

function normalizeDimension(
  input: unknown,
  field: 'width' | 'height',
): { readonly value: number } | { readonly error: string } {
  if (
    typeof input !== 'number'
    || !Number.isFinite(input)
    || input < SLIDE_LAYOUT_MIN_INCHES
    || input > SLIDE_LAYOUT_MAX_INCHES
  ) {
    return {
      error: `layout.${field} 必须是 ${SLIDE_LAYOUT_MIN_INCHES}–${SLIDE_LAYOUT_MAX_INCHES} 英寸内的有限数值。`,
    };
  }
  return { value: Math.round(input * EMU_PER_INCH) / EMU_PER_INCH };
}

function layoutErrorMessage(): string {
  return 'layout 必须是 16x9 / 16x10 / 4x3 或 { width, height, unit: "in" }。';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
