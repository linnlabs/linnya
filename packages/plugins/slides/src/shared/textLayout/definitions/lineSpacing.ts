/**
 * Slides 文本段落的唯一行距合同。
 *
 * multiple 对应 DrawingML a:spcPct；exactPt 对应 a:spcPts。
 * 旧 DeckSpec 的 number 双语义只允许在 admission 边界转换，不能进入布局主链。
 */
export type TextLineSpacing =
  | { kind: 'multiple'; value: number }
  | { kind: 'exactPt'; value: number };

export type TextLineSpacingResolution =
  | { source: 'paragraph' | 'list-style' | 'default' }
  | { source: 'unresolved'; reason: 'layout-master-context-unavailable' };

/** generated/imported 最终无继承值时的 PowerPoint 单倍行距（行高 = 字号 × SINGLE_SPACING_LINE_HEIGHT_EM）。 */
export const DEFAULT_TEXT_LINE_SPACING: TextLineSpacing = {
  kind: 'multiple',
  value: 1,
} as const;

export const DEFAULT_TEXT_LINE_SPACING_MULTIPLE = DEFAULT_TEXT_LINE_SPACING.value;

/**
 * PowerPoint 单倍行距（`spcPct` 100%）的行高与字号之比，与字体的 ascent/descent 无关：
 * 2026-11-14 用 PowerPoint 导 PDF 实测 10 种字体，纯西文、纯中文、混排都是 1.2。
 * multiple 行距只经 {@link multipleLineHeightEm} 换算成行高，别处不再写这个数。
 */
export const SINGLE_SPACING_LINE_HEIGHT_EM = 1.2;

/** multiple 行距 → 行高与字号之比（即 CSS 无单位 line-height）。 */
export function multipleLineHeightEm(multiple: number): number {
  return multiple * SINGLE_SPACING_LINE_HEIGHT_EM;
}

/** 任一行距 → 行高与字号之比；未声明按单倍行距。exactPt 需要字号才能换算。 */
export function resolveLineHeightEm(spacing: TextLineSpacing | undefined, fontSizePt: number): number {
  const resolved = spacing ?? DEFAULT_TEXT_LINE_SPACING;
  return resolved.kind === 'multiple'
    ? multipleLineHeightEm(resolved.value)
    : resolved.value / fontSizePt;
}

export function isTextLineSpacing(value: unknown): value is TextLineSpacing {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  if (!('kind' in value) || !('value' in value)) {
    return false;
  }
  return (value.kind === 'multiple' || value.kind === 'exactPt')
    && typeof value.value === 'number'
    && Number.isFinite(value.value)
    && value.value > 0;
}

export function createMultipleTextLineSpacing(value: number): TextLineSpacing {
  assertPositiveLineSpacing(value);
  return { kind: 'multiple', value };
}

/** 旧 number 双语义只允许由 DeckSpec/admission 调用。 */
export function normalizeLegacyTextLineSpacing(value: number): TextLineSpacing {
  assertPositiveLineSpacing(value);
  return value > 4
    ? { kind: 'exactPt', value }
    : { kind: 'multiple', value };
}

export function parseTextLineSpacingInput(value: unknown): TextLineSpacing | undefined {
  if (isTextLineSpacing(value)) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return normalizeLegacyTextLineSpacing(value);
  }
  return undefined;
}

function assertPositiveLineSpacing(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Text line spacing must be a positive finite number, received ${value}.`);
  }
}
