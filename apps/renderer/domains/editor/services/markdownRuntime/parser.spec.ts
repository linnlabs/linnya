import { beforeEach, describe, expect, it, vi } from 'vitest'

const parseMarkdownToBlocksByStreaming = vi.fn()

vi.mock('../../../../shared/services/markdownService', () => ({
  parseMarkdownToBlocksByStreaming,
}))

import { parseMarkdownToBlockEvents } from './parser'

describe('markdownRuntime parser', () => {
  beforeEach(() => {
    parseMarkdownToBlocksByStreaming.mockReset()
  })

  it('returns an empty result for blank markdown without touching the wasm service', async () => {
    await expect(parseMarkdownToBlockEvents('   ')).resolves.toEqual([])
    expect(parseMarkdownToBlocksByStreaming).not.toHaveBeenCalled()
  })

  it('delegates non-empty markdown to the streaming parser facade', async () => {
    parseMarkdownToBlocksByStreaming.mockResolvedValue([
      { block_type: 'BaseBlock', raw_content_fallback: 'hello' },
    ])

    await expect(parseMarkdownToBlockEvents('hello')).resolves.toEqual([
      { block_type: 'BaseBlock', raw_content_fallback: 'hello' },
    ])
    expect(parseMarkdownToBlocksByStreaming).toHaveBeenCalledWith('hello')
  })
})
