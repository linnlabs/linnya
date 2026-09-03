import type { CodeBlockNode, MarkdownToken } from '../../types'
import { parseFenceToken } from '../inline-parsers/fence-parser'

export function parseCodeBlock(token: MarkdownToken): CodeBlockNode {
  // If this code block is actually a diff (some markdown-it backends
  // classify fences vs code_block differently), delegate to the
  // fence parser to preserve original/updated fields.
  if (token.info?.startsWith('diff')) {
    return parseFenceToken(token)
  }

  const contentStr = String(token.content ?? '')
  const match = contentStr.match(/ type="application\/vnd\.ant\.([^"]+)"/)
  if (match?.[1]) {
    // 需要把 <antArtifact> 标签去掉
    // mutate token.content safely by assigning the cleaned string
    token.content = contentStr
      .replace(/<antArtifact[^>]*>/g, '')
      .replace(/<\/antArtifact>/g, '')
  }
  const hasMap = Array.isArray(token.map) && token.map.length === 2
  return {
    type: 'code_block',
    language: match ? match[1] : String(token.info ?? ''),
    code: String(token.content ?? ''),
    raw: String(token.content ?? ''),
    loading: !hasMap,
  }
}
