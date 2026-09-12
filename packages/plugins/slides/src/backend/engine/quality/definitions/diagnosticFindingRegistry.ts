import type { DiagnosticEvidenceKind } from './diagnosticEvidence';

export const DIAGNOSTIC_CODES = [
  'out_of_bounds',
  'element_edge_margin',
  'element_overlap',
  'text_decoration_collision',
  'origin_stacking',
  'text_overflow_risk',
  'short_numeric_text_wrapped',
  'text_single_glyph_last_line',
  'empty_slide',
  'zero_sized_renderable',
  'layout_constraint_compressed',
  'descendant_outside_computed_parent',
  'font_size_below_floor',
  'font_size_tier_overload',
  'font_family_inconsistent',
  'font_unresolved',
  'font_family_substituted',
  'font_style_substituted',
  'palette_too_diverse',
  'primary_hue_drift',
  'text_contrast_low',
  'image_aspect_distorted',
  'chart_identity_missing',
  'chart_label_capacity_exceeded',
  'text_too_dense',
  'text_too_sparse',
  'weak_hierarchy',
  'unbalanced_whitespace',
  'too_many_elements',
  'missing_visual_anchor',
  'slide_repetition',
  'probable_title_too_small',
  'data_page_missing_source',
  'paragraph_text_too_long',
  'title_ends_with_question',
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];
export type DiagnosticPriority = 'P0' | 'P1' | 'P2';
export type DiagnosticScope = 'node' | 'node_relation' | 'slide' | 'slide_relation' | 'deck';
export type DiagnosticCategory =
  | 'geometry'
  | 'constraint'
  | 'text_layout'
  | 'typography'
  | 'color'
  | 'composition'
  | 'consistency'
  | 'content';

export interface DiagnosticCodePolicy {
  readonly scope: DiagnosticScope;
  readonly category: DiagnosticCategory;
  readonly evidenceKind: DiagnosticEvidenceKind;
  readonly severities: readonly ('warning' | 'info')[];
  readonly confidences: readonly ('high' | 'medium' | 'low')[];
  readonly disposition: 'fix' | 'review' | 'informational';
  readonly verifyWith: readonly ('inspect' | 'render')[];
  readonly rootGrouping: 'root' | 'symptom' | 'none';
}

function policy(
  scope: DiagnosticScope,
  category: DiagnosticCategory,
  evidenceKind: DiagnosticEvidenceKind,
  severities: DiagnosticCodePolicy['severities'],
  confidences: DiagnosticCodePolicy['confidences'],
  disposition: DiagnosticCodePolicy['disposition'],
  verifyWith: DiagnosticCodePolicy['verifyWith'],
  rootGrouping: DiagnosticCodePolicy['rootGrouping'] = 'none',
): DiagnosticCodePolicy {
  return { scope, category, evidenceKind, severities, confidences, disposition, verifyWith, rootGrouping };
}

/** code 身份与最小治理策略的唯一真值源；阈值和判定仍由各规则拥有。 */
export const DIAGNOSTIC_CODE_REGISTRY = {
  // 显式背景/装饰仍保留越界事实，但其设计意图由 producer 表达为 info；不能在准入时丢失整份检查。
  out_of_bounds: policy('node', 'geometry', 'node_bounds', ['warning', 'info'], ['high'], 'fix', ['inspect', 'render']),
  element_edge_margin: policy('node', 'composition', 'node_bounds', ['info'], ['medium'], 'review', ['render']),
  element_overlap: policy('node_relation', 'geometry', 'node_overlap', ['warning'], ['medium'], 'review', ['inspect', 'render'], 'symptom'),
  text_decoration_collision: policy('node_relation', 'text_layout', 'node_overlap', ['warning'], ['high'], 'fix', ['inspect', 'render'], 'symptom'),
  origin_stacking: policy('node_relation', 'geometry', 'origin_stacking', ['warning'], ['high'], 'fix', ['inspect', 'render'], 'symptom'),
  text_overflow_risk: policy('node', 'text_layout', 'text_layout', ['warning'], ['high', 'medium'], 'fix', ['inspect', 'render'], 'symptom'),
  short_numeric_text_wrapped: policy('node', 'text_layout', 'text_layout', ['warning'], ['high'], 'fix', ['inspect', 'render'], 'symptom'),
  text_single_glyph_last_line: policy('node', 'text_layout', 'text_layout', ['warning'], ['medium'], 'fix', ['inspect', 'render'], 'symptom'),
  empty_slide: policy('slide', 'composition', 'content_presence', ['info'], ['high'], 'review', ['render']),
  zero_sized_renderable: policy('node', 'geometry', 'node_size', ['warning'], ['high'], 'fix', ['inspect', 'render'], 'symptom'),
  layout_constraint_compressed: policy('node', 'constraint', 'constraint_delta', ['warning'], ['high'], 'fix', ['inspect', 'render'], 'root'),
  descendant_outside_computed_parent: policy('node_relation', 'constraint', 'parent_overflow', ['warning'], ['high'], 'fix', ['inspect', 'render'], 'symptom'),
  font_size_below_floor: policy('node', 'typography', 'scalar_metric', ['warning'], ['high', 'medium'], 'fix', ['inspect', 'render']),
  font_size_tier_overload: policy('slide', 'typography', 'scalar_metric', ['warning'], ['medium'], 'review', ['render']),
  font_family_inconsistent: policy('deck', 'consistency', 'font_inventory', ['warning'], ['medium'], 'review', ['inspect', 'render']),
  font_unresolved: policy('deck', 'typography', 'font_inventory', ['warning'], ['high'], 'fix', ['inspect', 'render']),
  font_family_substituted: policy('deck', 'typography', 'font_resolution', ['warning'], ['high'], 'review', ['inspect', 'render']),
  font_style_substituted: policy('deck', 'typography', 'font_resolution', ['warning'], ['high'], 'review', ['inspect', 'render']),
  palette_too_diverse: policy('slide', 'color', 'color_palette', ['warning'], ['medium'], 'review', ['render']),
  primary_hue_drift: policy('deck', 'consistency', 'hue_drift', ['warning'], ['medium'], 'review', ['render']),
  text_contrast_low: policy('node_relation', 'color', 'color_contrast', ['warning'], ['medium'], 'review', ['render']),
  image_aspect_distorted: policy('node', 'geometry', 'image_aspect', ['warning'], ['high'], 'fix', ['inspect', 'render']),
  chart_identity_missing: policy('node', 'content', 'chart_readability', ['warning'], ['medium'], 'fix', ['inspect', 'render']),
  chart_label_capacity_exceeded: policy('node', 'composition', 'chart_readability', ['warning'], ['medium'], 'fix', ['inspect', 'render']),
  text_too_dense: policy('slide', 'composition', 'scalar_metric', ['warning'], ['medium'], 'review', ['render']),
  text_too_sparse: policy('slide', 'composition', 'scalar_metric', ['info'], ['low'], 'review', ['render']),
  weak_hierarchy: policy('slide', 'composition', 'scalar_metric', ['info'], ['low'], 'review', ['render']),
  unbalanced_whitespace: policy('slide', 'composition', 'margin_balance', ['info'], ['low'], 'review', ['render']),
  too_many_elements: policy('slide', 'composition', 'scalar_metric', ['warning'], ['medium'], 'review', ['render']),
  missing_visual_anchor: policy('slide', 'composition', 'visual_anchor', ['info'], ['low'], 'review', ['render']),
  slide_repetition: policy('slide_relation', 'consistency', 'slide_similarity', ['warning', 'info'], ['medium', 'low'], 'review', ['render']),
  probable_title_too_small: policy('node', 'content', 'text_pattern', ['info'], ['low'], 'review', ['render']),
  data_page_missing_source: policy('slide', 'content', 'content_presence', ['info'], ['low'], 'fix', ['inspect', 'render']),
  paragraph_text_too_long: policy('node', 'content', 'text_pattern', ['info'], ['low'], 'review', ['render']),
  title_ends_with_question: policy('node', 'content', 'text_pattern', ['info'], ['low'], 'review', ['render']),
} as const satisfies Record<DiagnosticCode, DiagnosticCodePolicy>;

export function getDiagnosticCodePolicy(code: DiagnosticCode): DiagnosticCodePolicy {
  return DIAGNOSTIC_CODE_REGISTRY[code];
}

/**
 * 将既有 severity、confidence 与 remediation 收敛为 Agent 可直接执行的顺序。
 *
 * priority 是 inspection 投影，不写回 finding，避免与正式质量事实形成第二真值源：
 * - P0：高置信、明确需要修复的确定性问题；
 * - P1：需要修复但证据仍需复核，或高置信的替换/一致性问题；
 * - P2：设计意图、审美与低风险复核项。
 */
export function classifyDiagnosticPriority(input: {
  readonly code: DiagnosticCode;
  readonly severity: 'warning' | 'info';
  readonly confidence: 'high' | 'medium' | 'low';
}): DiagnosticPriority {
  const policy = getDiagnosticCodePolicy(input.code);
  if (
    input.severity === 'warning'
    && input.confidence === 'high'
    && policy.disposition === 'fix'
  ) {
    return 'P0';
  }
  if (
    input.severity === 'warning'
    && (policy.disposition === 'fix' || input.confidence === 'high')
  ) {
    return 'P1';
  }
  return 'P2';
}
