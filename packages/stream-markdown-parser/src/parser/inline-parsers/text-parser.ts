import type { MarkdownToken, TextNode } from '../../types'

export function parseTextToken(token: MarkdownToken): TextNode {
  const content = String(token.content ?? '')
  return {
    type: 'text',
    content,
    raw: content,
  }
}
