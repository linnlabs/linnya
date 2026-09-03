// @vitest-environment jsdom

import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Editor } from '@tiptap/vue-3'
import { shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acceptAll: vi.fn(),
  rejectAll: vi.fn(),
  showNotification: vi.fn(),
}))

vi.mock('../store/useRevisionStore', () => ({
  useRevisionStore: () => ({
    acceptAllRevisionsInDocument: mocks.acceptAll,
    rejectAllRevisionsInDocument: mocks.rejectAll,
  }),
}))

vi.mock('@/app/notification', () => ({
  useNotificationStore: () => ({ show: mocks.showNotification }),
}))

vi.mock('../../../functions/resolveCurrentEditorMessage', () => ({
  resolveCurrentEditorMessage: (key: string) => key,
}))

import { useDocumentRevisionToolbar } from './useDocumentRevisionToolbar'

describe('useDocumentRevisionToolbar Apply All 结果呈现', () => {
  let editor: Editor

  beforeEach(() => {
    vi.clearAllMocks()
    editor = new Editor({
      extensions: [Document, Paragraph, Text],
      content: '<p>old</p>',
    })
  })

  afterEach(() => {
    editor.destroy()
  })

  it('后端已提交但 Renderer 未装载时显示不可自动消失的重新打开提示', async () => {
    mocks.acceptAll.mockResolvedValue('reload-required')
    const toolbar = useDocumentRevisionToolbar({
      editor: shallowRef(editor),
    })

    await toolbar.handleAcceptAllRevisionsInDocument()

    expect(mocks.showNotification).toHaveBeenCalledWith(
      'editor.revision.error.reloadRequired',
      'error',
      0
    )
  })

  it('后端未应用时不显示“后端已提交”的重新打开提示', async () => {
    mocks.rejectAll.mockResolvedValue('blocked')
    const toolbar = useDocumentRevisionToolbar({
      editor: shallowRef(editor),
    })

    await toolbar.handleRejectAllRevisionsInDocument()

    expect(mocks.showNotification).not.toHaveBeenCalled()
  })
})
