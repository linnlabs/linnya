import { describe, expect, it } from 'vitest'

import type { MarkdownInlineProjection } from '../../../services/markdownRuntime'
import { AutocompleteStateManager } from './AutocompleteStateManager'

describe('AutocompleteStateManager', () => {
  it('stores and clears suggestion projection together with suggestion text', () => {
    const manager = new AutocompleteStateManager()
    const projection: MarkdownInlineProjection = {
      fragments: [
        { type: 'text', text: 'hello', marks: [{ type: 'bold' }] },
        { type: 'hardBreak', marks: [] },
      ],
      spans: [
        { text: 'hello', marks: ['bold'] },
        { text: '\n', marks: [] },
      ],
      plainText: 'hello\n',
      newlineMode: 'hardBreak',
      sourceBlockCount: 1,
      droppedBlockCount: 0,
    }

    manager.setSuggestion('**hello**  \n', 12, projection)

    expect(manager.getState()).toMatchObject({
      suggestion: '**hello**  \n',
      suggestionPos: 12,
      suggestionProjection: projection,
    })

    manager.clearSuggestion()

    expect(manager.getState()).toMatchObject({
      suggestion: null,
      suggestionPos: null,
      suggestionProjection: null,
    })
  })
})
