import { describe, expect, it } from 'vitest'

import { vi } from 'vitest'
import { workspaceMarkdownSchemaLite } from 'src/domains/markdown'
import { blockEventToRootBlockNode } from '../../services/markdownRuntime'

vi.mock('../../../../shared/services/markdownService', () => ({
  parseMarkdownToBlocksByStreaming: vi.fn(),
}))

describe('blockEventToRootBlockNode', () => {
  it('materializes hardBreak and inlineLatex through markdownRuntime', () => {
    const node = blockEventToRootBlockNode(
      {
        block_type: 'BaseBlock',
        structured_content: [
          {
            type: 'text',
            text: '第一行',
            marks: [{ type: 'bold' }],
          },
          {
            type: 'hardBreak',
            marks: [],
          },
          {
            type: 'inlineLatex',
            attrs: { latexSource: 'x+y' },
          },
        ],
        raw_content_fallback: '第一行\n$x+y$',
      },
      workspaceMarkdownSchemaLite
    )

    expect(node?.toJSON()).toEqual({
      type: 'rootBlock',
      attrs: expect.objectContaining({ id: expect.any(String) }),
      content: [
        {
          type: 'baseBlock',
          attrs: expect.objectContaining({ id: expect.any(String), blockType: 'base' }),
          content: [
            { type: 'text', text: '第一行', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            expect.objectContaining({
              type: 'inlineLatex',
              attrs: expect.objectContaining({
                latexSource: 'x+y',
              }),
            }),
          ],
        },
      ],
    })
  })
})
