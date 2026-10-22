/**
 * @file chartEvent.ts
 * @description `linnya-chart` 围栏在 renderer 侧的唯一识别与准入入口。
 *
 * parser 已按 CommonMark 规则把围栏输出为完整 CodeBlock 事件；这里只解释 info string 的业务语义，
 * 不在 TypeScript 重建围栏状态。物化、粘贴、流式写入和 Pending 分类都经过本文件，
 * 因此同一事件在任何入口得到同一判断（与后端 `blockEventToDocJson` 共用 `@app/schemas` 准入）。
 */

import {
  MarkdownChartSpecInvalidError,
  admitMarkdownChartFenceBody,
  isMarkdownChartFenceLanguage,
  type MarkdownChartSpec,
  type MarkdownChartSpecInvalidContext,
} from '@app/schemas'
import type { BlockEventLike } from './types'

export function isChartBlockEvent(event: BlockEventLike): boolean {
  return event.block_type === 'CodeBlock' && isMarkdownChartFenceLanguage(event.language)
}

/** 准入图表围栏事件；无效时抛出带字段级诊断的 {@link MarkdownChartSpecInvalidError}。 */
export function admitChartBlockEvent(
  event: BlockEventLike,
  context: MarkdownChartSpecInvalidContext = {},
): MarkdownChartSpec {
  const admission = admitMarkdownChartFenceBody(
    typeof event.raw_content_fallback === 'string' ? event.raw_content_fallback : '',
  )
  if (!admission.ok) throw new MarkdownChartSpecInvalidError(admission.diagnostics, context)
  return admission.spec
}
