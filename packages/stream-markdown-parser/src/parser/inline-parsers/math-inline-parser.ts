import type { MarkdownToken, MathInlineNode } from '../../types'

// Parse a math_inline token (inline math expressions)
export function parseMathInlineToken(token: MarkdownToken): MathInlineNode {
  const content = token.content ?? ''
  // token.markup 为 '$$' 时表示 display-math 的定界符；raw 必须保持 $$...$$ 形式，便于复制与回放一致
  const raw = token.raw === '$$' ? `$$${content}$$` : token.raw || ''
  return {
    type: 'math_inline',
    content,
    loading: !!token.loading,
    raw,
  }
}
