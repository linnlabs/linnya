/**
 * PowerPoint 排公式用 Cambria Math 的 OpenType MATH 常量。预览的字形仍是 MathJax + STIX2，
 * 但分式上下偏移和上下标缩放改用这几项，行内分式在两边才占同样的行高；
 * 否则 PowerPoint 里含分式的行比预览高约 0.1in（24pt）。
 *
 * 数值来源：2026-11-17 用 fontTools 读 PowerPoint 自带的 Cambria Math（unitsPerEm 2048），
 * 并用 PowerPoint 导出 PDF 实测：分子基线上移 0.582em、分母下移 0.51em、分子分母为字号的 73%。
 * 单位 em。不改 MathJax 的 axis_height 与线宽，让分数线仍对齐 STIX2 的运算符。
 */
const CAMBRIA_MATH_UNITS_PER_EM = 2048;

export const POWERPOINT_MATH_LAYOUT = {
  /** ScriptPercentScaleDown：上下标、行内分式分子分母相对外层的字号比例。 */
  scriptSizeMultiplier: 0.73,
  /** FractionNumeratorShiftUp：行内（text style）分子基线最小上移量。 */
  fractionNumeratorShiftUp: 1200 / CAMBRIA_MATH_UNITS_PER_EM,
  /** FractionDenominatorShiftDown：行内分母基线最小下移量。 */
  fractionDenominatorShiftDown: 1030 / CAMBRIA_MATH_UNITS_PER_EM,
  /** FractionNumeratorDisplayStyleShiftUp：块公式分子基线最小上移量。 */
  fractionNumeratorDisplayShiftUp: 1550 / CAMBRIA_MATH_UNITS_PER_EM,
  /** FractionDenominatorDisplayStyleShiftDown：块公式分母基线最小下移量。 */
  fractionDenominatorDisplayShiftDown: 1370 / CAMBRIA_MATH_UNITS_PER_EM,
} as const;
