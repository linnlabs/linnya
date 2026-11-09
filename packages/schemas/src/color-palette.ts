import * as z from 'zod';

const HEX_COLOR_ERROR = '颜色须为十六进制，如 #1f3a5f';
const OutputHexSchema = z.string().regex(/^#[0-9a-f]{6}$/iu);
const InputHexSchema = z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu, { error: HEX_COLOR_ERROR });

export const COLOR_PALETTE_MAX_COUNT = 5;
export const COLOR_PALETTE_MAX_ACCENTS = 6;

export const ColorPaletteRelationSchema = z.enum(['mono', 'ink', 'analog', 'medium', 'contrast', 'multi']);
export type ColorPaletteRelation = z.infer<typeof ColorPaletteRelationSchema>;

export const ColorPaletteBaseSchema = z.enum(['light', 'tint', 'dark']);
export type ColorPaletteBase = z.infer<typeof ColorPaletteBaseSchema>;

export const ColorPaletteToneSchema = z.enum([
  'native', 'light', 'bright', 'soft', 'dull', 'strong', 'deep', 'dark', 'grayish',
]);
export type ColorPaletteTone = z.infer<typeof ColorPaletteToneSchema>;

/** OKLCH 色相区间：从第一个值顺时针到第二个值，单位度。 */
export const ColorPaletteHueRangeSchema = z.tuple([z.number().min(0).max(360), z.number().min(0).max(360)]);
export type ColorPaletteHueRange = z.infer<typeof ColorPaletteHueRangeSchema>;

export const ColorPaletteSubjectSchema = z.strictObject({
  hex: OutputHexSchema,
  name: z.string().min(1),
  share: z.number().min(0).max(1),
  images: z.number().int().nonnegative(),
  spot: z.boolean(),
  pinned: z.boolean(),
});
export type ColorPaletteSubject = z.infer<typeof ColorPaletteSubjectSchema>;

export const ColorPaletteSchema = z.strictObject({
  id: z.string().min(1),
  relation: ColorPaletteRelationSchema,
  base: ColorPaletteBaseSchema,
  tone: ColorPaletteToneSchema,
  bg: OutputHexSchema,
  surface: OutputHexSchema,
  ink: OutputHexSchema,
  muted: OutputHexSchema,
  accent: z.array(OutputHexSchema).min(1).max(COLOR_PALETTE_MAX_ACCENTS),
  chart: z.array(OutputHexSchema).min(1),
});
export type ColorPalette = z.infer<typeof ColorPaletteSchema>;

export const ColorPaletteSuggestionSchema = z.strictObject({
  id: z.string().min(1),
  subject: z.array(ColorPaletteSubjectSchema),
  excludedHues: z.array(ColorPaletteHueRangeSchema),
  palettes: z.array(ColorPaletteSchema).min(1),
});
export type ColorPaletteSuggestion = z.infer<typeof ColorPaletteSuggestionSchema>;

export const ColorPaletteSuggestOptionsSchema = z.strictObject({
  seedColors: z.array(InputHexSchema).optional(),
  pinnedColors: z.array(InputHexSchema).max(COLOR_PALETTE_MAX_ACCENTS, { error: '指定色最多 6 个' }).optional(),
  count: z.number().int().min(1, { error: '套数须为 1–5' }).max(COLOR_PALETTE_MAX_COUNT, { error: '套数须为 1–5' }).optional(),
  base: ColorPaletteBaseSchema.optional(),
  accentCount: z.number().int().min(1, { error: '强调色数量须为 1–6' })
    .max(COLOR_PALETTE_MAX_ACCENTS, { error: '强调色数量须为 1–6' }).optional(),
  avoidColors: z.array(InputHexSchema).optional(),
  rng: z.string().min(1).optional(),
});
export type ColorPaletteSuggestOptions = z.infer<typeof ColorPaletteSuggestOptionsSchema>;

export const ColorPaletteErrorCodeSchema = z.enum([
  'invalid_options',
  'too_many_images',
  'invalid_rng',
  'image_unreadable',
  'no_subject_color',
  'pinned_color_neutral',
  'pinned_color_conflict',
]);
export type ColorPaletteErrorCode = z.infer<typeof ColorPaletteErrorCodeSchema>;

const ColorPaletteFailureSchema = z.strictObject({
  status: z.literal('failed'),
  code: ColorPaletteErrorCodeSchema,
  message: z.string().min(1),
});
export type ColorPaletteFailure = z.infer<typeof ColorPaletteFailureSchema>;

export const ColorPaletteSuggestOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ok'),
    suggestion: ColorPaletteSuggestionSchema,
    /** 读不出来、被跳过的图片在入参里的下标。 */
    skippedImages: z.array(z.number().int().nonnegative()),
  }),
  ColorPaletteFailureSchema,
]);
export type ColorPaletteSuggestOutcome = z.infer<typeof ColorPaletteSuggestOutcomeSchema>;

/** 待检查的配色不校验色值：写错的颜色由检查结果逐项报告。 */
export const ColorPaletteDraftSchema = z.strictObject({
  bg: z.string(),
  surface: z.string(),
  ink: z.string(),
  muted: z.string(),
  accent: z.array(z.string()).min(1, { error: '至少要一个强调色' }),
  chart: z.array(z.string()).min(1, { error: '至少要一个图表色' }),
});
export type ColorPaletteDraft = z.infer<typeof ColorPaletteDraftSchema>;

export const ColorPaletteCheckInputSchema = z.strictObject({
  palette: ColorPaletteDraftSchema,
  excludedHues: z.array(ColorPaletteHueRangeSchema).optional(),
  pinnedColors: z.array(InputHexSchema).optional(),
});
export type ColorPaletteCheckInput = z.infer<typeof ColorPaletteCheckInputSchema>;

export const ColorPaletteCheckRuleSchema = z.enum([
  'invalid_color', 'ink_contrast', 'muted_contrast', 'accent_contrast', 'excluded_hue', 'chart_order',
]);
export type ColorPaletteCheckRule = z.infer<typeof ColorPaletteCheckRuleSchema>;

export const ColorPaletteFindingSchema = z.strictObject({
  rule: ColorPaletteCheckRuleSchema,
  role: z.string().min(1),
  value: z.string(),
  measured: z.number().optional(),
  required: z.number().optional(),
});
export type ColorPaletteFinding = z.infer<typeof ColorPaletteFindingSchema>;

export const ColorPaletteCheckResultSchema = z.strictObject({
  ok: z.boolean(),
  findings: z.array(ColorPaletteFindingSchema),
  /** 不合格时改动最少的版本；无法自动修复时为 null。 */
  suggested: ColorPaletteDraftSchema.nullable(),
});
export type ColorPaletteCheckResult = z.infer<typeof ColorPaletteCheckResultSchema>;

export const ColorPaletteCheckOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ok'), check: ColorPaletteCheckResultSchema }),
  ColorPaletteFailureSchema,
]);
export type ColorPaletteCheckOutcome = z.infer<typeof ColorPaletteCheckOutcomeSchema>;
