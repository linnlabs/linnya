import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useStreamingHandlers } from './useStreamingHandlers'

const mocks = vi.hoisted(() => ({
  getStreamingPluginState: vi.fn(() => ({ queue: [] })),
  processQueue: vi.fn(),
  getLastInsertPos: vi.fn(() => 42),
  finalizeStreamingParsing: vi.fn(async () => []),
  processChunkWithStreamingParser: vi.fn(async () => []),
  initializeNewStreamingParser: vi.fn(async () => ({})),
  positionTextSelectionWithHandshake: vi.fn(async () => ({ ok: true, pos: 42 })),
}))

vi.mock('../extensions/clipboard/markdown/StreamingMarkdown', () => ({
  STREAMING_PLUGIN_KEY: {
    getState: mocks.getStreamingPluginState,
  },
}))

vi.mock('../extensions/clipboard/markdown/streaming/queueProcessor', () => ({
  processQueue: mocks.processQueue,
  getLastInsertPos: mocks.getLastInsertPos,
}))

vi.mock('../../../shared/services/markdownService', () => ({
  initializeNewStreamingParser: mocks.initializeNewStreamingParser,
  processChunkWithStreamingParser: mocks.processChunkWithStreamingParser,
  finalizeStreamingParsing: mocks.finalizeStreamingParsing,
}))

vi.mock('../features/RenderVirtualization', () => ({
  positionTextSelectionWithHandshake: mocks.positionTextSelectionWithHandshake,
}))

function createEditor() {
  return {
    state: { doc: {} },
    view: {
      state: { doc: {} },
      dispatch: vi.fn(),
      nodeDOM: vi.fn(),
    },
    commands: {
      focus: vi.fn(),
      setTextSelection: vi.fn(),
      scrollIntoView: vi.fn(),
    },
  }
}

describe('useStreamingHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getStreamingPluginState.mockReturnValue({ queue: [] })
    mocks.getLastInsertPos.mockReturnValue(42)
    mocks.finalizeStreamingParsing.mockResolvedValue([])
    mocks.positionTextSelectionWithHandshake.mockResolvedValue({ ok: true, pos: 42 })
  })

  it('positions the final streaming cursor through the render virtualization handshake', async () => {
    const editor = createEditor()
    const { handlers } = useStreamingHandlers(
      { value: editor } as any,
      {
        wasmStreamingParser: {},
        aiError: { value: null },
      }
    )

    await handlers.onStreamEnd(true)

    expect(mocks.processQueue).toHaveBeenCalledWith(
      editor,
      { queue: [] },
      [],
      { finalize: true, errorOccurred: false }
    )
    expect(mocks.positionTextSelectionWithHandshake).toHaveBeenCalledWith(editor, 42)
    expect(editor.commands.setTextSelection).not.toHaveBeenCalled()
    expect(editor.commands.scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not move the cursor when streaming fails', async () => {
    const editor = createEditor()
    const { handlers } = useStreamingHandlers(
      { value: editor } as any,
      {
        wasmStreamingParser: {},
        aiError: { value: null },
      }
    )

    await handlers.onStreamEnd(false)

    expect(mocks.positionTextSelectionWithHandshake).not.toHaveBeenCalled()
    expect(editor.commands.setTextSelection).not.toHaveBeenCalled()
  })
})
