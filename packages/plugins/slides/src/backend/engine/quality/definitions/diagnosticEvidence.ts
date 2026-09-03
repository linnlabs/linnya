import { z } from 'zod';
import {
  DiagnosticAxisSchema,
  DiagnosticBoxSchema,
  DiagnosticIntentSchema,
  DiagnosticNodeRefSchema,
  DiagnosticSideSchema,
} from './diagnosticValues';

const MarginsSchema = z.object({
  left: z.number().finite(),
  right: z.number().finite(),
  top: z.number().finite(),
  bottom: z.number().finite(),
}).strict();

export const NodeBoundsEvidenceSchema = z.object({
  kind: z.literal('node_bounds'),
  assessment: z.enum(['overflow', 'insufficient_margin']),
  node: DiagnosticNodeRefSchema,
  referenceBox: DiagnosticBoxSchema,
  margins: MarginsSchema,
  violatedSides: z.array(DiagnosticSideSchema).min(1),
  thresholdInches: z.number().finite().nonnegative(),
  policyId: z.enum(['slide_bounds', 'safe_edge_margin']),
  fullBleedAxes: z.array(DiagnosticAxisSchema),
}).strict();

export const NodeSizeEvidenceSchema = z.object({
  kind: z.literal('node_size'),
  node: DiagnosticNodeRefSchema,
  zeroAxes: z.array(DiagnosticAxisSchema).min(1),
  renderableBasis: z.enum(['text', 'image', 'shape', 'chart', 'table', 'svg', 'group']),
  thresholdInches: z.number().finite().nonnegative(),
}).strict();

export const NodeOverlapEvidenceSchema = z.object({
  kind: z.literal('node_overlap'),
  nodes: z.tuple([DiagnosticNodeRefSchema, DiagnosticNodeRefSchema]),
  intersection: DiagnosticBoxSchema,
  smallerCoveredRatio: z.number().finite().min(0).max(1),
  overlapClass: z.literal('forbidden'),
  intent: DiagnosticIntentSchema,
}).strict().superRefine((evidence, context) => {
  if (evidence.nodes[0].nodeId >= evidence.nodes[1].nodeId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nodes'],
      message: 'overlap nodes must be sorted by nodeId',
    });
  }
});

export const OriginStackingEvidenceSchema = z.object({
  kind: z.literal('origin_stacking'),
  anchor: z.object({ x: z.number().finite(), y: z.number().finite(), unit: z.literal('in') }).strict(),
  toleranceInches: z.number().finite().positive(),
  nodes: z.array(DiagnosticNodeRefSchema).min(3),
  intent: DiagnosticIntentSchema,
}).strict();

export const ConstraintDeltaEvidenceSchema = z.object({
  kind: z.literal('constraint_delta'),
  node: DiagnosticNodeRefSchema,
  parent: DiagnosticNodeRefSchema,
  axis: DiagnosticAxisSchema,
  positionMode: z.enum(['flow', 'absolute']),
  declaredInches: z.number().finite().positive(),
  finalInches: z.number().finite().nonnegative(),
  minInches: z.number().finite().nonnegative().optional(),
  maxInches: z.number().finite().nonnegative().optional(),
  finalToDeclaredRatio: z.number().finite().nonnegative(),
}).strict();

export const ParentOverflowEvidenceSchema = z.object({
  kind: z.literal('parent_overflow'),
  parent: DiagnosticNodeRefSchema,
  descendants: z.array(DiagnosticNodeRefSchema).min(1),
  overflowSides: z.array(DiagnosticSideSchema).min(1),
  clipSemantics: z.enum(['visible', 'hidden']),
}).strict();

export const TextLayoutEvidenceSchema = z.object({
  kind: z.literal('text_layout'),
  issue: z.enum(['overflow', 'short_numeric_wrap', 'single_glyph_last_line']),
  node: DiagnosticNodeRefSchema,
  textPreview: z.string().trim().min(1),
  basis: z.enum(['finalized', 'estimated']),
  actualLineCount: z.number().int().positive(),
  paragraphIndex: z.number().int().nonnegative().optional(),
  tableCell: z.object({
    rowIndex: z.number().int().nonnegative(),
    columnIndex: z.number().int().nonnegative(),
  }).strict().optional(),
  orphanText: z.string().trim().min(1).optional(),
  contentWidthInches: z.number().finite().nonnegative(),
  contentHeightInches: z.number().finite().nonnegative(),
  maxLineWidthInches: z.number().finite().nonnegative(),
  horizontalOverflow: z.boolean(),
  verticalOverflow: z.boolean(),
  hiddenLineCount: z.number().int().nonnegative(),
}).strict();

export const ScalarMetricSchema = z.object({
  kind: z.literal('scalar_metric'),
  metric: z.enum([
    'text_area_ratio',
    'text_height_range',
    'renderable_count',
    'font_size',
    'font_size_tiers',
  ]),
  actual: z.number().finite(),
  operator: z.enum(['lt', 'gt']),
  threshold: z.number().finite(),
  unit: z.enum(['ratio', 'in', 'pt', 'count']),
  sampleCount: z.number().int().nonnegative(),
  samples: z.array(z.number().finite()),
  node: DiagnosticNodeRefSchema.optional(),
  semanticRole: z.string().trim().min(1).optional(),
}).strict();

export const VisualAnchorEvidenceSchema = z.object({
  kind: z.literal('visual_anchor'),
  largestNode: DiagnosticNodeRefSchema,
  largestAreaRatio: z.number().finite().min(0).max(1),
  maxTextNode: DiagnosticNodeRefSchema.optional(),
  maxFontSizePt: z.number().finite().nonnegative(),
  areaRatioThreshold: z.number().finite().min(0).max(1),
  fontSizeThresholdPt: z.number().finite().nonnegative(),
  sampleCount: z.number().int().positive(),
}).strict();

export const MarginBalanceEvidenceSchema = z.object({
  kind: z.literal('margin_balance'),
  axis: DiagnosticAxisSchema,
  margins: MarginsSchema,
  imbalanceRatio: z.number().finite().min(0),
  threshold: z.number().finite().min(0),
}).strict();

export const FontInventoryEvidenceSchema = z.object({
  kind: z.literal('font_inventory'),
  assessment: z.enum(['inconsistent_families', 'unresolved_families']),
  script: z.enum(['latin', 'eastAsian', 'complex', 'unknown']),
  resolvedFamilies: z.array(z.string().trim().min(1)),
  unresolvedFamilies: z.array(z.string().trim().min(1)),
  familyCount: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  runCount: z.number().int().nonnegative(),
}).strict();

export const FontResolutionEvidenceSchema = z.object({
  kind: z.literal('font_resolution'),
  difference: z.enum(['family', 'style']),
  requestedFamily: z.string().trim().min(1),
  resolvedFamily: z.string().trim().min(1),
  requestedStyle: z.string().trim().min(1),
  resolvedStyle: z.string().trim().min(1),
  script: z.enum(['latin', 'eastAsian', 'complex', 'unknown']),
  resolution: z.enum(['exact', 'substituted']),
  runCount: z.number().int().positive(),
  firstAffectedSlide: z.number().int().positive(),
}).strict();

export const ColorPaletteEvidenceSchema = z.object({
  kind: z.literal('color_palette'),
  hueClusterCount: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  sampleColors: z.array(z.string().trim().min(1)),
  sampleCount: z.number().int().nonnegative(),
}).strict();

export const HueDriftEvidenceSchema = z.object({
  kind: z.literal('hue_drift'),
  primaryHues: z.array(z.object({
    slideNumber: z.number().int().positive(),
    hueDegrees: z.number().finite().min(0).max(360),
  }).strict()).min(2),
  circularMeanDegrees: z.number().finite().min(0).max(360),
  circularStdDevDegrees: z.number().finite().nonnegative(),
  thresholdDegrees: z.number().finite().nonnegative(),
}).strict();

export const ColorContrastEvidenceSchema = z.object({
  kind: z.literal('color_contrast'),
  textNode: DiagnosticNodeRefSchema,
  containerNode: DiagnosticNodeRefSchema,
  textColor: z.string().trim().min(1),
  backgroundColor: z.string().trim().min(1),
  contrastRatio: z.number().finite().nonnegative(),
  thresholdRatio: z.number().finite().positive(),
  containerInference: z.literal('smallest_containing_shape'),
}).strict();

export const ImageAspectEvidenceSchema = z.object({
  kind: z.literal('image_aspect'),
  node: DiagnosticNodeRefSchema,
  fitMode: z.literal('stretch'),
  frameAspect: z.number().finite().positive(),
  naturalAspect: z.number().finite().positive(),
  deviationRatio: z.number().finite().nonnegative(),
  thresholdRatio: z.number().finite().nonnegative(),
}).strict();

const ChartReadabilityBaseEvidenceSchema = z.object({
  kind: z.literal('chart_readability'),
  node: DiagnosticNodeRefSchema,
  chartType: z.enum([
    'bar',
    'column',
    'line',
    'pie',
    'doughnut',
    'scatter',
    'area',
    'radar',
    'combo',
  ]),
  categoryCount: z.number().int().nonnegative(),
  seriesCount: z.number().int().nonnegative(),
  legendVisible: z.boolean(),
  dataLabelsVisible: z.boolean(),
});

export const ChartIdentityEvidenceSchema = ChartReadabilityBaseEvidenceSchema.extend({
  assessment: z.literal('identity_missing'),
  missingIdentity: z.enum(['categories', 'series']),
  unidentifiedLabelCount: z.number().int().positive(),
}).strict();

export const ChartLabelCapacityEvidenceSchema = ChartReadabilityBaseEvidenceSchema.extend({
  assessment: z.literal('label_capacity_exceeded'),
  channel: z.enum(['category_axis', 'data_labels']),
  direction: z.enum(['horizontal', 'vertical']),
  labelCount: z.number().int().positive(),
  maxLabel: z.string().trim().min(1),
  fontSizePt: z.number().finite().positive(),
  availableSpanInches: z.number().finite().positive(),
  estimatedRequiredSpanInches: z.number().finite().positive(),
  capacityRatio: z.number().finite().positive(),
  thresholdRatio: z.number().finite().positive(),
}).strict();

/** 图表身份与标签容量的可复算证据；不猜图表标题或作者意图。 */
export const ChartReadabilityEvidenceSchema = z.discriminatedUnion('assessment', [
  ChartIdentityEvidenceSchema,
  ChartLabelCapacityEvidenceSchema,
]);

export const SlideSimilarityEvidenceSchema = z.object({
  kind: z.literal('slide_similarity'),
  previousSlideNumber: z.number().int().positive(),
  currentSlideNumber: z.number().int().positive(),
  structureSimilarity: z.number().finite().min(0).max(1),
  contentSimilarity: z.number().finite().min(0).max(1),
  structureThreshold: z.number().finite().min(0).max(1),
  contentThreshold: z.number().finite().min(0).max(1),
}).strict();

export const ContentPresenceEvidenceSchema = z.object({
  kind: z.literal('content_presence'),
  expectedContent: z.enum(['renderable_content', 'source_annotation']),
  inspectedRegion: DiagnosticBoxSchema,
  observedCount: z.number().int().nonnegative(),
  triggeringNodeIds: z.array(z.string().trim().min(1)),
}).strict();

export const TextPatternEvidenceSchema = z.object({
  kind: z.literal('text_pattern'),
  pattern: z.enum(['probable_title', 'long_body', 'question_title']),
  node: DiagnosticNodeRefSchema,
  textPreview: z.string().trim().min(1),
  characterCount: z.number().int().nonnegative(),
  fontSizePt: z.number().finite().nonnegative(),
  characterThreshold: z.number().int().nonnegative().optional(),
  fontSizeThresholdPt: z.number().finite().nonnegative(),
}).strict();

export const DIAGNOSTIC_EVIDENCE_SCHEMAS = {
  node_bounds: NodeBoundsEvidenceSchema,
  node_size: NodeSizeEvidenceSchema,
  node_overlap: NodeOverlapEvidenceSchema,
  origin_stacking: OriginStackingEvidenceSchema,
  constraint_delta: ConstraintDeltaEvidenceSchema,
  parent_overflow: ParentOverflowEvidenceSchema,
  text_layout: TextLayoutEvidenceSchema,
  scalar_metric: ScalarMetricSchema,
  visual_anchor: VisualAnchorEvidenceSchema,
  margin_balance: MarginBalanceEvidenceSchema,
  font_inventory: FontInventoryEvidenceSchema,
  font_resolution: FontResolutionEvidenceSchema,
  color_palette: ColorPaletteEvidenceSchema,
  hue_drift: HueDriftEvidenceSchema,
  color_contrast: ColorContrastEvidenceSchema,
  image_aspect: ImageAspectEvidenceSchema,
  chart_readability: ChartReadabilityEvidenceSchema,
  slide_similarity: SlideSimilarityEvidenceSchema,
  content_presence: ContentPresenceEvidenceSchema,
  text_pattern: TextPatternEvidenceSchema,
} as const;

export type DiagnosticEvidenceKind = keyof typeof DIAGNOSTIC_EVIDENCE_SCHEMAS;
export type DiagnosticEvidence = z.infer<
  (typeof DIAGNOSTIC_EVIDENCE_SCHEMAS)[DiagnosticEvidenceKind]
>;
