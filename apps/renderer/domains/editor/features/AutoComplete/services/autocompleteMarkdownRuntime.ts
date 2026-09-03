import {
  blockEventsToInlineProjection,
  parseMarkdownToBlockEvents,
  structuredContentToInlineProjection,
} from '../../../services/markdownRuntime'
import type { MarkdownInlineProjection } from '../../../services/markdownRuntime'

interface AutocompleteMarkdownRuntimeOptions {
  operation: string
}

function buildPlainTextProjection(markdown: string): MarkdownInlineProjection {
  return structuredContentToInlineProjection(null, markdown)
}

export async function parseAutocompleteMarkdownToInlineProjection(
  markdown: string,
  options: AutocompleteMarkdownRuntimeOptions
): Promise<MarkdownInlineProjection> {
  if (!markdown) {
    return buildPlainTextProjection('')
  }

  const blockEvents = await parseMarkdownToBlockEvents(markdown)
  if (blockEvents.length === 0) {
    console.warn(`[${options.operation}] WASM 未产出 block events，autocomplete 回退为纯文本 projection`)
    return buildPlainTextProjection(markdown)
  }

  const projection = blockEventsToInlineProjection(blockEvents, {
    multiBlockMode: 'first-block',
    onDroppedBlocks: (info) => {
      console.warn(
        `[${options.operation}] Markdown 解析出多个块，autocomplete 仅消费第一块: requested=${info.requestedBlockCount}, dropped=${info.droppedBlockCount}`
      )
    },
  })

  if (projection.fragments.length === 0 && markdown.trim().length > 0) {
    console.warn(`[${options.operation}] inline projection 为空，autocomplete 回退为纯文本 projection`)
    return buildPlainTextProjection(markdown)
  }

  return projection
}
