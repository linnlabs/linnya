/**
 * @file chartIssues.ts
 * @description 无效图表围栏的问题清单（粘贴、流式写入共用）：给人看的简短条目，指向第几个图表和字段路径。
 */

import type { MarkdownChartSpecInvalidError } from '@app/schemas'

const MAX_LISTED_ISSUES = 6

export function listChartIssues(error: MarkdownChartSpecInvalidError): string[] {
  const prefix = error.context.chartOrdinal !== undefined ? `#${error.context.chartOrdinal} ` : ''
  const issues = error.diagnostics.slice(0, MAX_LISTED_ISSUES).map(diagnostic => {
    const location = diagnostic.location ? ` (${diagnostic.location.line}:${diagnostic.location.column})` : ''
    return `${prefix}${diagnostic.path}${location}: ${diagnostic.message}`
  })
  const remaining = error.diagnostics.length - issues.length
  if (remaining > 0) issues.push(`+${remaining}`)
  return issues
}
