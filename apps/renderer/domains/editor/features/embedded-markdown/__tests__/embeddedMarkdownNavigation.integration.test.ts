// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createMarkdownDocumentExtensions, parseMarkdownDocument } from '@linnya/markdown-document-core';
import { createEmbeddedMarkdownSpaceInput } from '../orchestration/createEmbeddedMarkdownSpaceInput';
import { installEmbeddedMarkdownNavigation } from '../orchestration/installEmbeddedMarkdownNavigation';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach(cleanup => cleanup()));
function fixture(content: string) {
  const element = document.createElement('div'); document.body.append(element);
  const captured = new Set<number>(); element.setPointerCapture = id => { captured.add(id); }; element.hasPointerCapture = id => captured.has(id); element.releasePointerCapture = id => { captured.delete(id); };
  const space = createEmbeddedMarkdownSpaceInput(), navigate = vi.fn();
  const editor = new Editor({ element, extensions: createMarkdownDocumentExtensions(), editorProps: { handleTextInput: (view, _from, _to, text) => space.capture(view, text) }, onTransaction: ({ transaction }) => space.record(transaction) });
  editor.commands.setContent(editor.schema.nodeFromJSON(parseMarkdownDocument(content)));
  const navigation = installEmbeddedMarkdownNavigation({ element, editor, space, navigate });
  cleanups.push(() => { navigation.dispose(); editor.destroy(); element.remove(); });
  const typeSpace = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
    const { from, to } = editor.state.selection, insert = () => editor.state.tr.insertText(' ', from, to);
    if (!editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, ' ', insert))) editor.view.dispatch(insert());
  };
  const pointer = (type: string, x: number, y: number) => { const event = new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }); Object.defineProperty(event, 'pointerId', { value: 1 }); element.dispatchEvent(event); };
  const pan = () => { pointer('pointerdown', 10, 10); pointer('pointermove', 12, 10); pointer('pointermove', 40, 20); pointer('pointerup', 40, 20); };
  return { element, editor, space, navigate, typeSpace, pan };
}
it('普通空格立即输入，未拖动保留；替换选区的空格在真实平移后只恢复原选区', () => {
  const f = fixture('abcdef'); f.editor.commands.setTextSelection(4); f.typeSpace();
  expect(f.editor.getText()).toBe('abc def'); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
  f.editor.commands.setTextSelection({ from: 2, to: 4 }); f.typeSpace(); expect(f.editor.getText()).toBe('a  def'); f.pan();
  expect(f.editor.getText()).toBe('abc def'); expect(f.navigate).toHaveBeenCalledExactlyOnceWith({ kind: 'pan', dx: 30, dy: 10 });
});
it('位置映射保留后续其他输入与IME内容，长按重复空格一起撤回', () => {
  const f = fixture('原文'); f.editor.commands.setTextSelection(3); f.typeSpace(); f.typeSpace();
  f.editor.commands.insertContentAt(1, '前缀'); f.editor.commands.insertContentAt(f.editor.state.doc.content.size - 1, '输入'); f.pan();
  expect(f.editor.getText()).toBe('前缀原文输入');
  f.typeSpace(); f.element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); f.editor.commands.insertContent('中文');
  f.pan(); expect(f.editor.getText()).toContain('中文'); expect(f.editor.getText()).toContain(' ');
});
it('正文普通滚动不传给外层，捏合/Cmd滚轮保持指针坐标，中键平移不改正文', () => {
  const f = fixture('正文');
  const ordinary = new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true }); f.element.dispatchEvent(ordinary); expect(ordinary.defaultPrevented).toBe(false); expect(f.navigate).not.toHaveBeenCalled();
  const pinch = new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, clientX: 120, clientY: 200, cancelable: true, bubbles: true }); f.element.dispatchEvent(pinch);
  expect(pinch.defaultPrevented).toBe(true); expect(f.navigate).toHaveBeenCalledWith({ kind: 'zoom', clientX: 120, clientY: 200, deltaY: -10 });
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', isComposing: true })); f.pan(); expect(f.editor.getText()).toBe('正文');
});
it('同一次Space触发的Markdown输入规则也撤回，既有输入仍可正常撤销', () => {
  const f = fixture(''); f.editor.commands.insertContent({ type: 'text', text: '#' }); f.editor.commands.setTextSelection(2); f.typeSpace();
  expect(f.editor.getJSON().content?.[0]?.type).toBe('heading'); f.pan();
  expect(f.editor.getJSON().content?.[0]?.type).toBe('paragraph'); expect(f.editor.getText()).toBe('#');
  f.editor.commands.insertContent('新'); f.typeSpace(); f.pan(); expect(f.editor.getText()).toContain('新');
  f.editor.commands.undo(); expect(f.editor.getText()).not.toContain('新');
});
