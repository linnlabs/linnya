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
}))

vi.mock('../useRevisionStore', () => ({
  useRevisionStore: () => ({
    acceptAllRevisionsInDocument: mocks.acceptAll,
    rejectAllRevisionsInDocument: mocks.rejectAll,
  }),
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

  it('提交期间禁用重复动作，完成后解除忙碌状态', async () => {
    let finish: () => void = () => {};
    mocks.acceptAll.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const toolbar = useDocumentRevisionToolbar({ editor: shallowRef(editor) });
    const accepting = toolbar.handleAcceptAllRevisionsInDocument();
    expect(toolbar.isApplyingRevisions.value).toBe(true);
    await toolbar.handleRejectAllRevisionsInDocument();
    expect(mocks.rejectAll).not.toHaveBeenCalled();
    finish();
    await accepting;
    expect(toolbar.isApplyingRevisions.value).toBe(false);
  });

  it('失败后恢复交互，允许重新提交', async () => {
    mocks.rejectAll.mockRejectedValueOnce(new Error('conflict'));
    const toolbar = useDocumentRevisionToolbar({ editor: shallowRef(editor) });
    await toolbar.handleRejectAllRevisionsInDocument();
    expect(toolbar.isApplyingRevisions.value).toBe(false);
    await toolbar.handleRejectAllRevisionsInDocument();
    expect(mocks.rejectAll).toHaveBeenCalledTimes(2);
  });
});
