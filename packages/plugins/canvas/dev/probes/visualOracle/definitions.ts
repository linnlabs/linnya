import { z } from 'zod';

export const VisualRectSchema = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const color = z.tuple([z.number(), z.number(), z.number()]).readonly();
export const VisualFontFactsSchema = z.object({ fontShorthand: z.string(), fontFamily: z.string(), fontSize: z.string(), fontStyle: z.string(),
  fontWeight: z.string(), fontStretch: z.string(), fontVariantNumeric: z.string(), fontQuery: z.string(), fontAvailable: z.boolean() });
const style = VisualFontFactsSchema.extend({ lineHeight: z.string(), letterSpacing: z.string(), direction: z.string(),
  fontFeatureSettings: z.string(), fontVariationSettings: z.string(), transform: z.string(), visibility: z.string(),
  color, background: color });
const glyph = { id: z.string(), text: z.string(), rects: z.array(VisualRectSchema), style };
const grapheme = z.discriminatedUnion('geometryKind', [
  z.object({ ...glyph, geometryKind: z.literal('range') }),
  z.object({ ...glyph, geometryKind: z.literal('marker-gutter'), marker: z.object({ listItem: VisualRectSchema, list: VisualRectSchema,
    firstLine: VisualRectSchema, paddingInlineStart: z.number().positive(), position: z.literal('outside'), listStyleType: z.literal('disc') }) }),
]);
export const VisualTextLayoutSchema = z.object({
  version: z.literal(3), dpr: z.number().positive(), fontsStatus: z.literal('loaded'), width: z.number().positive(),
  graphemes: z.array(grapheme),
  lines: z.array(z.object({ id: z.string(), rect: VisualRectSchema, graphemeIds: z.array(z.string()) })),
});
export type VisualTextLayout = z.infer<typeof VisualTextLayoutSchema>;
export type VisualRect = z.infer<typeof VisualRectSchema>;
export type VisualColor = readonly [number, number, number];
export interface VisualImage { readonly width: number; readonly height: number; readonly rgba: Uint8Array }
export interface VisualInkMoment { mass: number; x: number; y: number }
export interface VisualMonochromePixels {
  readonly legacyMask: Uint8Array;
  /** 正数是同一fg/bg模型身份，0未准入，-1表示冲突或严格字簇覆盖。 */
  readonly structureOwner: Int32Array;
  readonly referenceContrast: Float64Array;
  readonly actualContrast: Float64Array;
}
export interface VisualStructureFacts {
  readonly model: 'per-pixel-qualified-rgb-mean';
  readonly union: number;
  readonly residual: number;
  readonly residualRatio: number;
  readonly modeledPixels: number;
}
export interface VisualCoverage {
  readonly model: 'contrast-max' | 'rgb-alpha-mean' | 'fixed-reference-glyph-weights';
  readonly referenceMass: number; readonly actualMass: number; readonly massRatio: number;
  readonly referenceCentroid: { readonly x: number; readonly y: number } | null;
  readonly actualCentroid: { readonly x: number; readonly y: number } | null;
  readonly positionDelta: number | null;
}
export const VISUAL_NEGATIVES = ['missing-han', 'missing-punctuation', 'missing-emoji', 'clip-last-line', 'shift-one-pixel', 'wrong-size', 'red-to-blue', 'emoji-hue', 'emoji-grayscale', 'non-text-stripe', 'missing-marker', 'text-opacity'] as const;
export const VisualNegativeSchema = z.enum(VISUAL_NEGATIVES);
export type VisualNegative = z.infer<typeof VisualNegativeSchema>;

// 初始候选界限在GPU采集前固定。不能因某张Windows图未过而扩大；正/负例报告用于校准审阅。
export const VISUAL_TEXT_LIMITS = Object.freeze({
  layoutPhysicalPx: 0.125,
  contrastFloor: 24,
  centroidPhysicalPx: 0.5,
  massRatioMin: 0.7,
  massRatioMax: 1.35,
  graphemeResidualRatio: 0.2,
  lineResidualRatio: 0.05,
  solidColorDelta: 8,
  solidCoverage: 0.9,
  outsideColorDelta: 8,
});
