import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  useAiWritingVirtualizationKeepAlive,
  type AiWritingVirtualizationEditor,
} from './useAiWritingVirtualizationKeepAlive'

const keepAliveEvents = vi.hoisted(() => vi.fn())

vi.mock('../../RenderVirtualization', () => ({
  RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY: Symbol('RenderVirtualizationKeepAlivePort'),
  applyRenderVirtualizationKeepAliveCommand: vi.fn((input: {
    legacyTarget: EventTarget | null
    command: { blockId: string; reason: string }
    active: boolean
  }) => {
    keepAliveEvents(input.legacyTarget, {
      ...input.command,
      active: input.active,
    })
    return true
  }),
}))

function createEditor(target: EventTarget): AiWritingVirtualizationEditor {
  return {
    isDestroyed: false,
    view: {
      dom: target,
    },
  }
}

describe('useAiWritingVirtualizationKeepAlive', () => {
  it('pins the target block while the prompt is visible and releases it when hidden', async () => {
    keepAliveEvents.mockClear()
    const editorDom = new EventTarget()
    const editor = ref<AiWritingVirtualizationEditor | null>(createEditor(editorDom))
    const isVisible = ref(false)
    const targetBlockId = ref('block-a')

    useAiWritingVirtualizationKeepAlive({ editor, isVisible, targetBlockId })

    expect(keepAliveEvents).not.toHaveBeenCalled()

    isVisible.value = true
    await nextTick()

    expect(keepAliveEvents).toHaveBeenCalledWith(editorDom, {
      blockId: 'block-a',
      reason: 'ai-writing',
      active: true,
    })

    isVisible.value = false
    await nextTick()

    expect(keepAliveEvents).toHaveBeenLastCalledWith(editorDom, {
      blockId: 'block-a',
      reason: 'ai-writing',
      active: false,
    })
  })

  it('moves the keep-alive lease when the prompt retargets another block', async () => {
    keepAliveEvents.mockClear()
    const editorDom = new EventTarget()
    const editor = ref<AiWritingVirtualizationEditor | null>(createEditor(editorDom))
    const isVisible = ref(true)
    const targetBlockId = ref('block-a')

    useAiWritingVirtualizationKeepAlive({ editor, isVisible, targetBlockId })
    await nextTick()

    targetBlockId.value = 'block-b'
    await nextTick()

    expect(keepAliveEvents.mock.calls).toEqual([
      [editorDom, { blockId: 'block-a', reason: 'ai-writing', active: true }],
      [editorDom, { blockId: 'block-a', reason: 'ai-writing', active: false }],
      [editorDom, { blockId: 'block-b', reason: 'ai-writing', active: true }],
    ])
  })

  it('releases the old editor DOM before pinning through a new editor DOM', async () => {
    keepAliveEvents.mockClear()
    const oldDom = new EventTarget()
    const nextDom = new EventTarget()
    const editor = ref<AiWritingVirtualizationEditor | null>(createEditor(oldDom))
    const isVisible = ref(true)
    const targetBlockId = ref('block-a')

    useAiWritingVirtualizationKeepAlive({ editor, isVisible, targetBlockId })
    await nextTick()

    editor.value = createEditor(nextDom)
    await nextTick()

    expect(keepAliveEvents.mock.calls).toEqual([
      [oldDom, { blockId: 'block-a', reason: 'ai-writing', active: true }],
      [oldDom, { blockId: 'block-a', reason: 'ai-writing', active: false }],
      [nextDom, { blockId: 'block-a', reason: 'ai-writing', active: true }],
    ])
  })
})
