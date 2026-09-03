import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarkdownInlineProjection } from '../../../services/markdownRuntime'

const {
  parseMarkdownToBlockEvents,
  blockEventsToInlineProjection,
  structuredContentToInlineProjection,
} = vi.hoisted(() => ({
  parseMarkdownToBlockEvents: vi.fn(),
  blockEventsToInlineProjection: vi.fn(),
  structuredContentToInlineProjection: vi.fn(),
}))

vi.mock('../../../services/markdownRuntime', () => ({
  parseMarkdownToBlockEvents,
  blockEventsToInlineProjection,
  structuredContentToInlineProjection,
}))

import { parseAutocompleteMarkdownToInlineProjection } from './autocompleteMarkdownRuntime'

describe('autocompleteMarkdownRuntime', () => {
  const plainTextProjection: MarkdownInlineProjection = {
    fragments: [{ type: 'text', text: 'plain', marks: [] }],
    spans: [{ text: 'plain', marks: [] }],
    plainText: 'plain',
    newlineMode: 'hardBreak',
    sourceBlockCount: 1,
    droppedBlockCount: 0,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    structuredContentToInlineProjection.mockReturnValue(plainTextProjection)
  })

  it('falls back to plain text projection when wasm returns no block events', async () => {
    parseMarkdownToBlockEvents.mockResolvedValue([])

    const projection = await parseAutocompleteMarkdownToInlineProjection('plain', {
      operation: 'autocomplete-test',
    })

    expect(projection).toBe(plainTextProjection)
    expect(structuredContentToInlineProjection).toHaveBeenCalledWith(null, 'plain')
    expect(blockEventsToInlineProjection).not.toHaveBeenCalled()
  })

  it('uses first-block mode when projecting autocomplete markdown', async () => {
    const projected: MarkdownInlineProjection = {
      fragments: [
        { type: 'text', text: 'first', marks: [{ type: 'bold' }] },
        { type: 'hardBreak', marks: [] },
        {
          type: 'inlineLatex',
          attrs: { latexSource: 'x+y' },
          latexSource: 'x+y',
          textRepresentation: '$x+y$',
        },
      ],
      spans: [
        { text: 'first', marks: ['bold'] },
        { text: '\n$x+y$', marks: [] },
      ],
      plainText: 'first\n$x+y$',
      newlineMode: 'hardBreak',
      sourceBlockCount: 2,
      droppedBlockCount: 1,
    }

    parseMarkdownToBlockEvents.mockResolvedValue([{ block_type: 'Paragraph' }, { block_type: 'Paragraph' }])
    blockEventsToInlineProjection.mockImplementation((_events, options) => {
      expect(options.multiBlockMode).toBe('first-block')
      options.onDroppedBlocks?.({ requestedBlockCount: 2, droppedBlockCount: 1 })
      return projected
    })

    const projection = await parseAutocompleteMarkdownToInlineProjection('**first**\n$x+y$\n\nsecond', {
      operation: 'autocomplete-test',
    })

    expect(projection).toBe(projected)
    expect(blockEventsToInlineProjection).toHaveBeenCalledTimes(1)
  })
})
