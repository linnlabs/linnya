import type { FootnoteReferenceNode, MarkdownToken } from '../../types'

export function parseFootnoteRefToken(
  token: MarkdownToken,
): FootnoteReferenceNode {
  const tokenMeta = (token.meta ?? {}) as unknown as { label?: string }
  return {
    type: 'footnote_reference',
    id: String(tokenMeta.label ?? ''),
    raw: `[^${String(tokenMeta.label ?? '')}]`,
  }
}
