import type { BlockEventLike } from './types'

export async function parseMarkdownToBlockEvents(markdown: string): Promise<BlockEventLike[]> {
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    return []
  }

  const { parseMarkdownToBlocksByStreaming } = await import(
    '../../../../shared/services/markdownService'
  )
  const blockEvents = await parseMarkdownToBlocksByStreaming(markdown)
  return Array.isArray(blockEvents) ? blockEvents : []
}
