/**
 * @file markdownChartConstants.ts
 * @description Markdown 图表块的稳定常量：围栏语言、规格版本、图表类型和准入上限。
 */

/** 正式图表的围栏语言。其他语言（含 `chart`、`echarts`）始终保持普通代码语义。 */
export const MARKDOWN_CHART_FENCE_LANGUAGE = 'linnya-chart';

/** 当前规格版本。canonical 投影省略该字段；未知版本拒绝，不猜测升级。 */
export const MARKDOWN_CHART_SPEC_VERSION = 1;

export const MARKDOWN_CHART_TYPES = [
  'bar',
  'line',
  'area',
  'pie',
  'doughnut',
  'scatter',
  'radar',
  'combo',
] as const;

export type MarkdownChartType = (typeof MARKDOWN_CHART_TYPES)[number];

/**
 * 六套单色阶与三套多色色带，始终沿色带顺序取色。名称是稳定合同；具体色值与主题适配
 * 由渲染器拥有。省略仍是 verdant，避免改变已有 canonical 文档的默认语义。
 */
export const MARKDOWN_CHART_PALETTES = ['verdant', 'warm', 'aqua', 'teal', 'violet', 'mono', 'sea', 'pastel', 'mist'] as const;

export type MarkdownChartPalette = (typeof MARKDOWN_CHART_PALETTES)[number];

export const MARKDOWN_CHART_DEFAULT_PALETTE: MarkdownChartPalette = 'verdant';

/**
 * 准入上限。首版发布后不得直接收紧：已存的合法文档必须始终能读回。
 * 超出上限的数据应由研究流程先聚合或拆图，保留口径说明。
 */
export const MARKDOWN_CHART_LIMITS = {
  maxSeries: 20,
  maxCategories: 1000,
  maxDataPoints: 5000,
  /** 规范化 JSON 的 UTF-8 字节数上限。 */
  maxCanonicalBytes: 128 * 1024,
  /** 未规范化的围栏正文上限，仅用于在解析前拒绝明显异常的输入。 */
  maxFenceBodyBytes: 1024 * 1024,
  maxTitleLength: 200,
  maxDescriptionLength: 1000,
  maxLabelLength: 200,
} as const;

/** 判断 CodeBlock 事件的 info string 首词是否为正式图表语言（大小写敏感，与 CommonMark 一致）。 */
export function isMarkdownChartFenceLanguage(language: string | null | undefined): boolean {
  return language === MARKDOWN_CHART_FENCE_LANGUAGE;
}
