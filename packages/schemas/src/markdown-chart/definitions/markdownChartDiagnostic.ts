/**
 * @file markdownChartDiagnostic.ts
 * @description 图表规格准入失败的稳定诊断。`code` 供程序分类，`message` 面向写入图表的 Agent 或用户。
 */

export const MARKDOWN_CHART_DIAGNOSTIC_CODES = [
  'invalid_json',
  'not_an_object',
  'invalid_shape',
  'invalid_chart_type',
  'unsupported_version',
  'unknown_field',
  'limit_exceeded',
  'length_mismatch',
  'duplicate_name',
  'out_of_range',
  'invalid_combination',
] as const;

export type MarkdownChartDiagnosticCode = (typeof MARKDOWN_CHART_DIAGNOSTIC_CODES)[number];

export interface MarkdownChartDiagnosticLocation {
  /** 1-based，指围栏正文内的位置。 */
  readonly line: number;
  readonly column: number;
}

export interface MarkdownChartDiagnostic {
  readonly code: MarkdownChartDiagnosticCode;
  /** 字段路径，例如 `series[1].values`；根对象为 `$`。 */
  readonly path: string;
  readonly message: string;
  /** 仅 JSON 语法错误携带。 */
  readonly location?: MarkdownChartDiagnosticLocation;
}

/** 规则检查阶段使用的路径片段，输出时统一格式化为 {@link MarkdownChartDiagnostic.path}。 */
export type MarkdownChartPathSegment = string | number;
