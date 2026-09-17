// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { afterEach, expect, it } from 'vitest';
import { batchPendingDispatches } from '../batchPendingProjection';
import { isPendingProjectionBatch } from '../../store/pendingProjectionBatch';

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
function createEditor() {
  const editor = new Editor({ extensions: [Document, Paragraph, Text], content: '<p>A</p>' });
  editors.push(editor);
  return editor;
}

it('连续事务看到批次内最新 state，最终 DOM 与 state 一致', async () => {
  const editor = createEditor();
  await batchPendingDispatches(editor, async () => {
    editor.view.dispatch(editor.state.tr.insertText('B', 2));
    expect(editor.state.doc.textContent).toBe('AB');
    expect(editor.view.dom.textContent).toBe('A');
    editor.view.dispatch(editor.state.tr.insertText('C', 3));
    expect(isPendingProjectionBatch(editor)).toBe(true);
    expect(editor.isEditable).toBe(false);
  });
  expect(editor.state.doc.textContent).toBe('ABC');
  expect(editor.view.dom.textContent).toBe('ABC');
  expect(isPendingProjectionBatch(editor)).toBe(false);
  expect(editor.isEditable).toBe(true);
});

it('批次异常仍完成已应用事务的 DOM 协调并恢复交互', async () => {
  const editor = createEditor();
  await expect(batchPendingDispatches(editor, async () => {
    editor.view.dispatch(editor.state.tr.insertText('B', 2));
    throw new Error('projection failed');
  })).rejects.toThrow('projection failed');
  expect(editor.view.dom.textContent).toBe('AB');
  expect(editor.state.doc.textContent).toBe('AB');
  expect(isPendingProjectionBatch(editor)).toBe(false);
  expect(editor.isEditable).toBe(true);
});
