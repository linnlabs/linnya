import type { EmojiNode, MarkdownToken } from '../../types'

export function parseEmojiToken(token: MarkdownToken): EmojiNode {
  const name = String(token.content ?? '')
  const markup = String(token.markup ?? '')
  return {
    type: 'emoji',
    name,
    markup,
    raw: `:${name}:`,
  }
}
