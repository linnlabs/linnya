import type { InlineCodeNode, MarkdownToken } from '../../types'

export function parseInlineCodeToken(token: MarkdownToken): InlineCodeNode {
  const code = String(token.content ?? '')
  return {
    type: 'inline_code',
    code,
    raw: code,
  }
}
