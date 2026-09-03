import type { TextSpan } from './revisionTextSpanTypes'

/**
 * @file revisionTextSpanUtils.ts
 * @description Revision 协议层的 TextSpan 通用工具。
 */

/**
 * 将 spans 扁平化为纯文本
 */
export function flattenSpansToText(spans: TextSpan[]): string {
  return spans.map((span) => span.text).join('')
}
