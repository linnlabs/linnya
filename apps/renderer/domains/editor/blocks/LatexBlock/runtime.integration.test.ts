// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { Editor, Node } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Paragraph from '@tiptap/extension-paragraph';
import { NodeSelection } from 'prosemirror-state';
import { useLatexEditorStore } from './store/latexEditor';
import { useLatexEditorActions } from './runtime';
const Formula = Node.create({
  name: 'latexBlock',
  group: 'block',
  atom: true,
  addAttributes: () => ({ id: { default: 'formula' }, latexSource: { default: 'x' } }),
  parseHTML: () => [{ tag: 'div[data-formula]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', { 'data-formula': '', ...HTMLAttributes }],
});
const editors: Editor[] = [];
describe('公式编辑流程', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });
  afterEach(() => {
    editors.splice(0).forEach(e => e.destroy());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it('目标节点选中后单事务修改公式，非法源码或选择不匹配不提交', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Formula],
      content: {
        type: 'doc',
        content: [
          { type: 'latexBlock', attrs: { id: 'formula', latexSource: 'x' } },
          { type: 'paragraph' },
        ],
      },
    });
    editors.push(editor);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    const state = useLatexEditorStore(),
      actions = useLatexEditorActions();
    state.showPanel('formula', 'x', null, editor);
    state.updateSource('y^2');
    expect(await actions.submitCurrentLatex()).toBe(true);
    expect(editor.state.doc.firstChild?.attrs.latexSource).toBe('y^2');
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    state.updateSource('\\notARealCommand');
    expect(await actions.submitCurrentLatex()).toBe(false);
    expect(editor.state.doc.firstChild?.attrs.latexSource).toBe('y^2');
    state.updateSource('z');
    state.showPanel('other', 'z', null, editor);
    expect(await actions.submitCurrentLatex()).toBe(false);
  });
  it('隐藏和取消保留原有10ms清理时机及取消后的源码', async () => {
    vi.useFakeTimers();
    const state = useLatexEditorStore(),
      actions = useLatexEditorActions();
    state.showPanel('formula', 'x', null);
    state.updateSource('changed');
    const cancel = actions.cancelEdit();
    expect(state.isPanelVisible).toBe(false);
    expect(state.currentSource).toBe('x');
    expect(state.targetNodeId).toBe('formula');
    await vi.advanceTimersByTimeAsync(10);
    await cancel;
    expect(state.targetNodeId).toBeNull();
    expect(state.currentSource).toBe('x');
    state.showPanel('formula', 'y', null);
    const hide = actions.hidePanel();
    await vi.advanceTimersByTimeAsync(10);
    await hide;
    expect(state.currentSource).toBe('');
    expect(state.originalSource).toBe('');
  });
});
