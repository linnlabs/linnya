/**
 * @file chartSourceDraft.ts
 * @description 源码编辑面板里“正在输入的 JSON”如何解释：有效、无效（带诊断）或为空。
 *
 * 草稿与文档共用同一个准入入口，所以面板里“有效”就是写入文档时一定会被接受；
 * 反之，保存按钮不会把任何文档会拒绝的内容写进去。
 */

import {
  admitMarkdownChartFenceBody,
  serializeMarkdownChartSpec,
  type MarkdownChartDiagnostic,
  type MarkdownChartSpec,
} from '@app/schemas'

export type ChartSourceEvaluation =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid'; readonly diagnostics: readonly MarkdownChartDiagnostic[] }
  | { readonly kind: 'valid'; readonly spec: MarkdownChartSpec; readonly canonicalText: string }

export function evaluateChartSource(text: string): ChartSourceEvaluation {
  if (text.trim() === '') return { kind: 'empty' }
  const admission = admitMarkdownChartFenceBody(text)
  return admission.ok
    ? { kind: 'valid', spec: admission.spec, canonicalText: admission.canonicalText }
    : { kind: 'invalid', diagnostics: admission.diagnostics }
}

/** 面板打开时展示的源码：规格的 canonical 文本，与 Markdown 围栏正文一致。 */
export function sourceTextOfSpec(spec: MarkdownChartSpec): string {
  return serializeMarkdownChartSpec(spec)
}

/** 保存是否会改变文档：以 canonical 文本比较，空白与键序差异不算改动。 */
export function isChartSourceChanged(evaluation: ChartSourceEvaluation, baselineCanonicalText: string): boolean {
  return evaluation.kind !== 'valid' || evaluation.canonicalText !== baselineCanonicalText
}
