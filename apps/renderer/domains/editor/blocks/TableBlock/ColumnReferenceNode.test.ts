// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { ColumnReferenceNode } from './ColumnReferenceNode';

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  vi.useRealTimers();
});

describe('ColumnReferenceNode', () => {
  it('把有效的列引用输入转换为可序列化的 inline token', () => {
    vi.useFakeTimers();
    editor = new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        ColumnReferenceNode.configure({
          validateRef: refKey => refKey === 'A' ? '#123456' : null,
        }),
      ],
      content: '',
    });

    editor.commands.insertContent('{{A}}', { applyInputRules: true });
    vi.runAllTimers();

    expect(editor.getJSON()).toMatchObject({
      content: [{
        content: [{
          type: 'columnReference',
          attrs: {
            refKey: 'A',
            label: '{{A}}',
            color: '#123456',
          },
        }],
      }],
    });
    expect(editor.getText()).toBe('{{A}}');
  });
});
