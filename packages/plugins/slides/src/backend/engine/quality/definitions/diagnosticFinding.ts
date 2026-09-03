import { z } from 'zod';
import {
  ColorContrastEvidenceSchema,
  ColorPaletteEvidenceSchema,
  ChartIdentityEvidenceSchema,
  ChartLabelCapacityEvidenceSchema,
  ConstraintDeltaEvidenceSchema,
  ContentPresenceEvidenceSchema,
  FontInventoryEvidenceSchema,
  FontResolutionEvidenceSchema,
  HueDriftEvidenceSchema,
  ImageAspectEvidenceSchema,
  MarginBalanceEvidenceSchema,
  NodeBoundsEvidenceSchema,
  NodeOverlapEvidenceSchema,
  NodeSizeEvidenceSchema,
  OriginStackingEvidenceSchema,
  ParentOverflowEvidenceSchema,
  ScalarMetricSchema,
  SlideSimilarityEvidenceSchema,
  TextLayoutEvidenceSchema,
  TextPatternEvidenceSchema,
  VisualAnchorEvidenceSchema,
} from './diagnosticEvidence';
import {
  DIAGNOSTIC_CODE_REGISTRY,
  type DiagnosticCode,
} from './diagnosticFindingRegistry';
import {
  DiagnosticSourceRefSchema,
  DiagnosticVerificationSchema,
} from './diagnosticValues';
import type {
  DiagnosticSourceRef,
  DiagnosticVerification,
} from './diagnosticValues';

const FINDING_EVIDENCE_SCHEMA_BY_CODE = {
  out_of_bounds: NodeBoundsEvidenceSchema.extend({
    assessment: z.literal('overflow'),
    policyId: z.literal('slide_bounds'),
  }),
  element_edge_margin: NodeBoundsEvidenceSchema.extend({
    assessment: z.literal('insufficient_margin'),
    policyId: z.literal('safe_edge_margin'),
  }),
  element_overlap: NodeOverlapEvidenceSchema,
  origin_stacking: OriginStackingEvidenceSchema,
  text_overflow_risk: TextLayoutEvidenceSchema.extend({ issue: z.literal('overflow') }),
  short_numeric_text_wrapped: TextLayoutEvidenceSchema.extend({ issue: z.literal('short_numeric_wrap') }),
  text_single_glyph_last_line: TextLayoutEvidenceSchema.extend({
    issue: z.literal('single_glyph_last_line'),
    basis: z.literal('finalized'),
    paragraphIndex: z.number().int().nonnegative(),
    orphanText: z.string().trim().min(1),
  }),
  empty_slide: ContentPresenceEvidenceSchema.extend({ expectedContent: z.literal('renderable_content') }),
  zero_sized_renderable: NodeSizeEvidenceSchema,
  layout_constraint_compressed: ConstraintDeltaEvidenceSchema,
  descendant_outside_computed_parent: ParentOverflowEvidenceSchema,
  font_size_below_floor: ScalarMetricSchema.extend({ metric: z.literal('font_size') }),
  font_size_tier_overload: ScalarMetricSchema.extend({ metric: z.literal('font_size_tiers') }),
  font_family_inconsistent: FontInventoryEvidenceSchema.extend({ assessment: z.literal('inconsistent_families') }),
  font_unresolved: FontInventoryEvidenceSchema.extend({ assessment: z.literal('unresolved_families') }),
  font_family_substituted: FontResolutionEvidenceSchema.extend({ difference: z.literal('family') }),
  font_style_substituted: FontResolutionEvidenceSchema.extend({ difference: z.literal('style') }),
  palette_too_diverse: ColorPaletteEvidenceSchema,
  primary_hue_drift: HueDriftEvidenceSchema,
  text_contrast_low: ColorContrastEvidenceSchema,
  image_aspect_distorted: ImageAspectEvidenceSchema,
  chart_identity_missing: ChartIdentityEvidenceSchema,
  chart_label_capacity_exceeded: ChartLabelCapacityEvidenceSchema,
  text_too_dense: ScalarMetricSchema.extend({ metric: z.literal('text_area_ratio'), operator: z.literal('gt') }),
  text_too_sparse: ScalarMetricSchema.extend({ metric: z.literal('text_area_ratio'), operator: z.literal('lt') }),
  weak_hierarchy: ScalarMetricSchema.extend({ metric: z.literal('text_height_range'), operator: z.literal('lt') }),
  unbalanced_whitespace: MarginBalanceEvidenceSchema,
  too_many_elements: ScalarMetricSchema.extend({ metric: z.literal('renderable_count'), operator: z.literal('gt') }),
  missing_visual_anchor: VisualAnchorEvidenceSchema,
  slide_repetition: SlideSimilarityEvidenceSchema,
  probable_title_too_small: TextPatternEvidenceSchema.extend({ pattern: z.literal('probable_title') }),
  data_page_missing_source: ContentPresenceEvidenceSchema.extend({ expectedContent: z.literal('source_annotation') }),
  paragraph_text_too_long: TextPatternEvidenceSchema.extend({ pattern: z.literal('long_body') }),
  title_ends_with_question: TextPatternEvidenceSchema.extend({ pattern: z.literal('question_title') }),
} as const satisfies Record<DiagnosticCode, z.ZodTypeAny>;

export type DiagnosticEvidenceFor<C extends DiagnosticCode> = z.infer<
  (typeof FINDING_EVIDENCE_SCHEMA_BY_CODE)[C]
>;

export interface DiagnosticRemediation {
  readonly disposition: 'fix' | 'review' | 'informational';
  readonly targetNodeIds: readonly string[];
  readonly verifyWith: readonly DiagnosticVerification[];
}

interface DiagnosticFindingEnvelope<C extends DiagnosticCode> {
  readonly findingId: string;
  readonly code: C;
  readonly severity: 'warning' | 'info';
  readonly confidence: 'high' | 'medium' | 'low';
  readonly slides: readonly number[];
  readonly evidence: DiagnosticEvidenceFor<C>;
  readonly sourceRefs: readonly DiagnosticSourceRef[];
  readonly rootCauseKey?: string;
  readonly remediation: DiagnosticRemediation;
}

/** code 与 evidence 在 TypeScript 层同样是一一绑定的判别联合。 */
export type DiagnosticFinding = {
  [C in DiagnosticCode]: DiagnosticFindingEnvelope<C>
}[DiagnosticCode];

interface QualityDiagnosticDraftEnvelope<C extends DiagnosticCode> {
  readonly code: C;
  readonly severity: DiagnosticFindingEnvelope<C>['severity'];
  readonly confidence: DiagnosticFindingEnvelope<C>['confidence'];
  readonly slides: DiagnosticFindingEnvelope<C>['slides'];
  readonly evidence: DiagnosticEvidenceFor<C>;
  readonly rootCauseKey?: string;
}

/** quality producer 的输出；inspection 只负责补 artifact 内身份与治理字段。 */
export type QualityDiagnosticDraft = {
  [C in DiagnosticCode]: QualityDiagnosticDraftEnvelope<C>
}[DiagnosticCode];

function remediationSchemaFor(code: DiagnosticCode) {
  const policy = DIAGNOSTIC_CODE_REGISTRY[code];
  return z.object({
    disposition: z.literal(policy.disposition),
    targetNodeIds: z.array(z.string().trim().min(1)),
    verifyWith: z.array(DiagnosticVerificationSchema).length(policy.verifyWith.length),
  }).strict().superRefine((remediation, context) => {
    if (remediation.verifyWith.some((value, index) => value !== policy.verifyWith[index])) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verifyWith'],
        message: `verifyWith must match the ${code} registry policy`,
      });
    }
  });
}

function findingBranch<C extends DiagnosticCode>(code: C) {
  const policy = DIAGNOSTIC_CODE_REGISTRY[code];
  return z.object({
    findingId: z.string().trim().min(1),
    code: z.literal(code),
    severity: z.enum(['warning', 'info']).refine(
      (severity) => policy.severities.includes(severity),
      `${code} severity must match the registry policy`,
    ),
    confidence: z.enum(['high', 'medium', 'low']).refine(
      (confidence) => policy.confidences.includes(confidence),
      `${code} confidence must match the registry policy`,
    ),
    slides: z.array(z.number().int().positive()).min(1),
    evidence: FINDING_EVIDENCE_SCHEMA_BY_CODE[code],
    sourceRefs: z.array(DiagnosticSourceRefSchema).min(1),
    rootCauseKey: z.string().trim().min(1).optional(),
    remediation: remediationSchemaFor(code),
  }).strict();
}

const DIAGNOSTIC_FINDING_BRANCHES = [
  findingBranch('out_of_bounds'),
  findingBranch('element_edge_margin'),
  findingBranch('element_overlap'),
  findingBranch('origin_stacking'),
  findingBranch('text_overflow_risk'),
  findingBranch('short_numeric_text_wrapped'),
  findingBranch('text_single_glyph_last_line'),
  findingBranch('empty_slide'),
  findingBranch('zero_sized_renderable'),
  findingBranch('layout_constraint_compressed'),
  findingBranch('descendant_outside_computed_parent'),
  findingBranch('font_size_below_floor'),
  findingBranch('font_size_tier_overload'),
  findingBranch('font_family_inconsistent'),
  findingBranch('font_unresolved'),
  findingBranch('font_family_substituted'),
  findingBranch('font_style_substituted'),
  findingBranch('palette_too_diverse'),
  findingBranch('primary_hue_drift'),
  findingBranch('text_contrast_low'),
  findingBranch('image_aspect_distorted'),
  findingBranch('chart_identity_missing'),
  findingBranch('chart_label_capacity_exceeded'),
  findingBranch('text_too_dense'),
  findingBranch('text_too_sparse'),
  findingBranch('weak_hierarchy'),
  findingBranch('unbalanced_whitespace'),
  findingBranch('too_many_elements'),
  findingBranch('missing_visual_anchor'),
  findingBranch('slide_repetition'),
  findingBranch('probable_title_too_small'),
  findingBranch('data_page_missing_source'),
  findingBranch('paragraph_text_too_long'),
  findingBranch('title_ends_with_question'),
] as const;

export const DiagnosticFindingSchema: z.ZodType<DiagnosticFinding> = z.discriminatedUnion(
  'code',
  DIAGNOSTIC_FINDING_BRANCHES,
).superRefine((finding, context) => {
  const slides = new Set(finding.slides);
  if (slides.size !== finding.slides.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['slides'],
      message: 'slides must not contain duplicates',
    });
  }
});

export function admitDiagnosticFinding(input: unknown): DiagnosticFinding {
  return DiagnosticFindingSchema.parse(input);
}

export function admitDiagnosticFindings(inputs: readonly unknown[]): DiagnosticFinding[] {
  const findings = inputs.map(admitDiagnosticFinding);
  const ids = new Set<string>();
  for (const finding of findings) {
    if (ids.has(finding.findingId)) {
      throw new Error(`Duplicate diagnostic finding id: ${finding.findingId}`);
    }
    ids.add(finding.findingId);
  }
  return findings;
}
