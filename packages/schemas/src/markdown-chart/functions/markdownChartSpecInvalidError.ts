/**
 * @file markdownChartSpecInvalidError.ts
 * @description 专属围栏无效时的统一失败：当前原子写入不提交，诊断供 Agent 或用户修正。
 */

import { MARKDOWN_CHART_FENCE_LANGUAGE } from '../definitions/markdownChartConstants';
import type { MarkdownChartDiagnostic } from '../definitions/markdownChartDiagnostic';

export const MARKDOWN_CHART_SPEC_INVALID = 'MARKDOWN_CHART_SPEC_INVALID';

export interface MarkdownChartSpecInvalidContext {
  /** 该图表围栏在本次输入中的序号（1-based，只计 `linnya-chart` 围栏）。 */
  readonly chartOrdinal?: number;
  /** 该围栏在本次输入解析出的块序列中的位置（1-based）。 */
  readonly blockIndex?: number;
}

const MAX_LISTED_DIAGNOSTICS = 20;

export function formatMarkdownChartDiagnostics(diagnostics: readonly MarkdownChartDiagnostic[]): string {
  const listed = diagnostics.slice(0, MAX_LISTED_DIAGNOSTICS).map(diagnostic => {
    const location = diagnostic.location
      ? ` (line ${diagnostic.location.line}, column ${diagnostic.location.column})`
      : '';
    return `- ${diagnostic.path}${location}: ${diagnostic.message}`;
  });
  const remaining = diagnostics.length - listed.length;
  if (remaining > 0) listed.push(`- ...and ${remaining} more issue(s).`);
  return listed.join('\n');
}

function describeLocation(context: MarkdownChartSpecInvalidContext): string {
  const parts = [
    context.chartOrdinal !== undefined ? `#${context.chartOrdinal}` : null,
    context.blockIndex !== undefined ? `block ${context.blockIndex}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

export class MarkdownChartSpecInvalidError extends Error {
  readonly code = MARKDOWN_CHART_SPEC_INVALID;

  constructor(
    readonly diagnostics: readonly MarkdownChartDiagnostic[],
    readonly context: MarkdownChartSpecInvalidContext = {},
  ) {
    super(
      `Invalid ${MARKDOWN_CHART_FENCE_LANGUAGE} fence${describeLocation(context)}. No change was committed.\n`
      + `${formatMarkdownChartDiagnostics(diagnostics)}\n`
      + `The fence body must be one JSON object. Fix it and write again; use a "json" or "text" fence instead to show the source as plain code.`,
    );
    this.name = 'MarkdownChartSpecInvalidError';
  }
}

export function isMarkdownChartSpecInvalidError(error: unknown): error is MarkdownChartSpecInvalidError {
  return error instanceof MarkdownChartSpecInvalidError;
}
