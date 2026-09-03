// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dragMoveBlock } from './MoveCommands'

const mocks = vi.hoisted(() => ({
  positionCursorAtBlockEndWithHandshake: vi.fn(async () => ({ ok: true, blockId: 'source-1', pos: 1 })),
}))

vi.mock('../../../features/RenderVirtualization', () => ({
  positionCursorAtBlockEndWithHandshake: mocks.positionCursorAtBlockEndWithHandshake,
}))

function createEditor() {
  const tr = {
    mapping: {
      map: vi.fn((pos) => pos),
    },
    delete: vi.fn(),
    insert: vi.fn(),
  }
  const state = { tr }
  const dispatch = vi.fn()

  const editor = {
  }

  return { editor, state, tr, dispatch }
}

describe('MoveCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
  })

  it('restores the cursor after drag move through the render virtualization handshake', async () => {
    const { editor, state, tr, dispatch } = createEditor()
    const command = dragMoveBlock({
      sourceId: 'source-1',
      targetIndex: 3,
      validationResult: {
        valid: true,
        needsMove: true,
        sourceBlock: {
          pos: 5,
          node: { nodeSize: 8 },
        },
        insertPos: 20,
      },
    })

    const result = command({ state, dispatch, editor })

    expect(result).toBe(true)
    expect(tr.delete).toHaveBeenCalledWith(5, 13)
    expect(tr.insert).toHaveBeenCalledWith(20, { nodeSize: 8 })
    expect(dispatch).toHaveBeenCalledWith(tr)

    await Promise.resolve()

    expect(mocks.positionCursorAtBlockEndWithHandshake).toHaveBeenCalledWith(editor, 'source-1', {
      temporaryPinMs: 800,
    })
  })

  it('does not fall back to Tiptap chain when dispatch is missing', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { editor, state } = createEditor()
    editor.chain = vi.fn()
    const command = dragMoveBlock({
      sourceId: 'source-1',
      targetIndex: 3,
      validationResult: {
        valid: true,
        needsMove: true,
        sourceBlock: {
          pos: 5,
          node: { nodeSize: 8 },
        },
        insertPos: 20,
      },
    })

    expect(command({ state, editor })).toBe(false)
    expect(editor.chain).not.toHaveBeenCalled()
    expect(consoleWarn).toHaveBeenCalledWith('[MoveCommands] 缺少 state.tr 或 dispatch，无法执行块移动事务')
  })
})
