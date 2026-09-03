import type { MarkdownToken, ReferenceNode } from '../../types'

// Parse a reference token from markdown-it
export function parseReferenceToken(token: MarkdownToken): ReferenceNode {
  const id = String(token.content ?? '')
  const raw = String(token.markup ?? `[${token.content ?? ''}]`)
  return {
    type: 'reference',
    id,
    raw,
  }
}
