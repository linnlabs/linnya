/**
 * AestheticLint 类型契约
 *
 * 这一层只放"类型"（codes / issues / report / metrics），不放任何阈值常量、
 * 不放业务实现，方便外部模块（HeuristicLint / inspect feedback）
 * 只 import 类型而不引入实现的图依赖。
 *
 * 主类 `AestheticLint` 与各子模块的输入/输出都收敛到这里；新增 lint code
 * 时只改这一处，其他模块通过 union type 编译期发散。
 */

import type { LayoutLintReport } from '../LayoutLint.js';
import type { QualityDiagnosticDraft } from '../definitions';

/**
 * AestheticLint 当前支持的所有 lint code。
 *
 * 命名规范（保持稳定，外部 fixture / docs 直接引用）：
 * - Tier-1：纯几何 / 颜色 / 字号，机械可判定，无语义猜测；
 * - Tier-2：启发式（仅 info），可能有误判，留给 AI 自审；
 * - Tier-3：文字型启发式（仅 info），同上。
 */
export type AestheticLintCode =
  | 'text_too_dense'
  | 'text_too_sparse'
  | 'weak_hierarchy'
  | 'unbalanced_whitespace'
  | 'slide_repetition'
  | 'too_many_elements'
  | 'missing_visual_anchor'
  /** P1 Tier-1：任意文本字号低于阈值（纯数值，无语义依赖） */
  | 'font_size_below_floor'
  /** P1 Tier-1：单页字号档位过多（>4 档），层级信号失焦 */
  | 'font_size_tier_overload'
  /** P1 Tier-1：同一主导脚本使用的 resolved 字体族 >2 种 */
  | 'font_family_inconsistent'
  /** 字体目录已就绪，但某个 run 的声明字体无法解析到可用字体 */
  | 'font_unresolved'
  /** 字体目录已就绪，当前 run 因缺字或 family 缺失而改用了另一个字体族 */
  | 'font_family_substituted'
  /** 字体解析命中的真实 face 字重/斜体与作者请求不同，测量和绘制会采用真实样式 */
  | 'font_style_substituted'
  /** P1 Tier-1：非全幅元素贴近画布边缘（< 0.3"），可能压迫视觉留白 */
  | 'element_edge_margin'
  /** P1 Tier-1：单页非中性主色 hue 簇 > 4，色彩使用过散 */
  | 'palette_too_diverse'
  /** P1 Tier-1：跨页主色 HSL hue 圆形 stddev > 25°，主色漂移 */
  | 'primary_hue_drift'
  /** P1 Tier-1：文本与底层填充 WCAG 对比度 < 3.0，可读性风险 */
  | 'text_contrast_low'
  /** P1 Tier-1：图片 fit=stretch 且元素宽高比与原图差 > 10%，会压扁/拉伸 */
  | 'image_aspect_distorted'
  /** P1 Tier-1：类别或系列缺少可见身份通道；外部文字可能补充，因此需 render 复核。 */
  | 'chart_identity_missing'
  /** P1 Tier-1：标签估算所需跨度明显超过图表可用跨度。 */
  | 'chart_label_capacity_exceeded'
  /**
   * P1 Tier-2 启发式：probable-title 字号偏小。
   * 判定：单页字号最大的文本元素 fontSize < 14pt（且页面 ≥ 2 个文本元素，避免单条 caption 误判）。
   * 仅 info；可能误判（装饰性大字 / 极简风格刻意小标题），需 AI 自审。
   */
  | 'probable_title_too_small'
  /**
   * P1 Tier-2 启发式：数据页面缺来源标注。
   * 判定：页面含 chart/table，且画布底部 15% 内无任何 text 元素。
   * 仅 info；可能误判（封面 chart 不需要来源），需 AI 自审。
   */
  | 'data_page_missing_source'
  /**
   * P1 Tier-3 文字型启发式：段落 / 项目符号文字过长。
   * 判定：text 元素纯文本字符数 > 80 且 fontSize ≤ 18pt（避开标题）。
   * 仅 info；可能误判（刻意做长引文 / 法律声明），需 AI 自审。
   */
  | 'paragraph_text_too_long'
  /**
   * P1 Tier-3 文字型启发式：主标题以问号结尾。
   * 判定：单页 fontSize 最大的 text 元素（且 ≥ 20pt）trim 后以 `?` / `？` 结尾。
   * 仅 info；可能误判（章节过渡页有意用问句），需 AI 自审。
   */
  | 'title_ends_with_question';

export type AestheticLintIssue = Extract<QualityDiagnosticDraft, { code: AestheticLintCode }>;

export interface AestheticLintReport {
  /** 基础布局 lint 结果 */
  layout: LayoutLintReport;
  /** 审美 lint issues */
  aesthetic: AestheticLintIssue[];
  /** 可复算的 finding 与相邻页相似度指标，不作为质量门禁 */
  metrics: AestheticLintMetrics;
}

export interface SlideRepetitionPair {
  previousSlideNumber: number;
  slideNumber: number;
  similarity: number;
}

export interface AestheticLintMetrics {
  layoutWarnings: number;
  aestheticWarnings: number;
  aestheticInfos: number;
  averageAdjacentSimilarity: number;
  maxAdjacentSimilarity: number;
  repeatedAdjacentPairs: number;
  longestRepetitionRun: number;
}
