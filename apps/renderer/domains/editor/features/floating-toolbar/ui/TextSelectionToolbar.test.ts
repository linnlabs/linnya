// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { createPinia } from 'pinia';
import { afterEach, expect, it } from 'vitest';
import { createApp, h, nextTick, shallowRef } from 'vue';
import { FloatingToolbar } from '@linnya/renderer-ui';
import TextColorMark from '../../../marks/TextColor';
import TextHighlightMark from '../../../marks/TextHighlight';
import TextSelectionToolbar from './TextSelectionToolbar.vue';

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

it('生产颜色工具条保存真实文字选区，应用颜色与高亮，Escape 从色板返回触发器', async () => {
  const host = document.createElement('div');
  const editorHost = document.createElement('div');
  document.body.append(host, editorHost);
  const editor = new Editor({
    element: editorHost,
    extensions: [StarterKit, TextColorMark, TextHighlightMark],
    content: '<p>Hello world</p>',
    editorProps: { handleScrollToSelection: () => true },
  });
  editor.commands.setTextSelection({ from: 1, to: 6 });
  const currentEditor = shallowRef(editor);
  let nextEditor: Editor | undefined;
  const app = createApp({ render: () => h(FloatingToolbar, {
    show: true, position: { top: 0, left: 0 }, onMousedown: (event: MouseEvent) => event.preventDefault(),
  }, { default: () => h(TextSelectionToolbar, { editor: currentEditor.value }) }) });
  app.use(createPinia()); app.mount(host);
  dispose = () => { app.unmount(); editor.destroy(); nextEditor?.destroy(); host.remove(); editorHost.remove(); };
  const buttons = host.querySelectorAll('.linnya-toolbar-color-button');
  const text = buttons[0]; const highlight = buttons[1];
  if (!(text instanceof HTMLButtonElement) || !(highlight instanceof HTMLButtonElement)) throw new Error('Missing color triggers');
  expect(text.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))).toBe(false);
  text.click(); await nextTick();
  const color = host.querySelector('.text-color-cell');
  if (!(color instanceof HTMLButtonElement)) throw new Error('Missing text palette');
  color.click(); await nextTick();
  expect(editor.getAttributes('textColor').color).toBe('red_text');
  expect(editor.state.selection.from).toBe(1); expect(editor.state.selection.to).toBe(6);
  expect(text.getAttribute('aria-expanded')).toBe('false');
  highlight.click(); await nextTick();
  const highlightCell = host.querySelector('.highlight-color-cell');
  if (!(highlightCell instanceof HTMLButtonElement)) throw new Error('Missing highlight palette');
  highlightCell.click(); await nextTick();
  expect(editor.getAttributes('textHighlight').color).toBe('red_text');
  text.click(); await nextTick();
  const palette = host.querySelector('.inline-color-picker');
  if (!(palette instanceof HTMLElement)) throw new Error('Missing reopened palette');
  palette.focus();
  palette.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await nextTick(); await nextTick();
  expect(text.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(text);
  expect(editor.getAttributes('textColor').color).toBe('red_text');
  nextEditor = new Editor({ extensions: [StarterKit, TextColorMark, TextHighlightMark], content: '<p>Next document</p>' });
  nextEditor.commands.setTextSelection({ from: 1, to: 5 });
  currentEditor.value = nextEditor; await nextTick();
  text.click(); await nextTick();
  editor.commands.setTextSelection({ from: 7, to: 12 }); await nextTick();
  expect(text.getAttribute('aria-expanded')).toBe('true');

});
