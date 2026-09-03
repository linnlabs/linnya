import type { DiagnosticCode } from '../../../engine/quality/definitions';

/** Agent 行动文案属于 inspection 投影，不进入 quality 事实合同。 */
const ACTION_BY_CODE = {
  out_of_bounds: '移动或缩放节点，使其回到页面边界内',
  element_edge_margin: '复核安全边距；若非出血设计则增大边距',
  element_overlap: '结合视觉意图复核两节点关系，必要时调整位置或尺寸',
  origin_stacking: '为堆叠节点补齐预期布局位置',
  text_overflow_risk: '增大文本区域、缩短文字或调整字号与行距',
  short_numeric_text_wrapped: '增大文本框宽度或使用不指定宽度的单行文本',
  text_single_glyph_last_line: '增大文本区域宽度、缩短文字或调整列宽，避免末行只剩一个字',
  empty_slide: '确认空白页是否有意；否则补充内容',
  zero_sized_renderable: '为可渲染节点提供有效宽高',
  layout_constraint_compressed: '修正父级约束或节点声明尺寸，避免非预期压缩',
  descendant_outside_computed_parent: '修正父容器尺寸或后代定位关系',
  font_size_below_floor: '提高字号或减少同一区域文字量',
  font_size_tier_overload: '合并相近字号层级，收敛排版层次',
  font_family_inconsistent: '复核字体使用并收敛非必要字体族',
  font_unresolved: '改用可用字体或补齐字体资源',
  font_family_substituted: '确认替代字体效果，必要时改用可稳定解析的字体',
  font_style_substituted: '确认字重与字形替代效果，必要时调整样式',
  palette_too_diverse: '复核颜色角色并减少无必要色相',
  primary_hue_drift: '统一跨页主色角色或确认主题切换有意',
  text_contrast_low: '提高文字与背景的对比度',
  image_aspect_distorted: '保持图片原始宽高比或调整裁切方式',
  chart_identity_missing: '显示必要的图例或数据标签，使类别或系列可识别',
  chart_label_capacity_exceeded: '减少标签、扩大图表或调整标签位置与字号',
  text_too_dense: '减少文字量、拆页或扩大内容区域',
  text_too_sparse: '复核信息密度与留白是否符合页面意图',
  weak_hierarchy: '拉开标题、正文与注释的视觉层级',
  unbalanced_whitespace: '复核主内容在页面中的留白分布',
  too_many_elements: '合并、分组或拆分页内元素',
  missing_visual_anchor: '复核是否需要更明确的主视觉或核心结论',
  slide_repetition: '复核连续页面是否需要差异化结构',
  probable_title_too_small: '确认候选标题角色，必要时提高字号',
  data_page_missing_source: '为数据结论补充来源说明',
  paragraph_text_too_long: '拆分长段落并提炼关键信息',
  title_ends_with_question: '确认标题是否应改为结论式表达',
} as const satisfies Record<DiagnosticCode, string>;

export function getDiagnosticAction(code: DiagnosticCode): string {
  return ACTION_BY_CODE[code];
}
