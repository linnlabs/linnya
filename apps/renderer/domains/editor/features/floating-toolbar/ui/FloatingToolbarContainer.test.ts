// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { FloatingToolbar } from '@linnya/renderer-ui';
import { FloatingToolbarExtension } from '../FloatingToolbarExtension';
import { registerCommonToolbarProvider } from '../registry';
import { floatingToolbarService } from '../service';
import FloatingToolbarContainer from './FloatingToolbarContainer.vue';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); floatingToolbarService.close(); vi.restoreAllMocks(); });

it('共享外壳保留真实 Editor 选区和格式命令，其他业务工具条仍属于外部点击', async () => {
  const editorHost = document.createElement('div');
  const toolbarHost = document.createElement('div');
  document.body.append(editorHost, toolbarHost);
  registerCommonToolbarProvider({
    name: 'shared-toolbar-integration',
    shouldShow: ({ editor }) => !editor.state.selection.empty,
    getItems: ({ editor }) => [{ id: 'bold', component: defineComponent({
      setup: () => () => h('button', { onClick: () => editor.commands.toggleBold() }, 'Bold'),
    }) }],
  });
  const editor = new Editor({ element: editorHost, extensions: [StarterKit, FloatingToolbarExtension], content: '<p>Hello world</p>' });
  // jsdom 无文本布局；只替换坐标读取，选区、插件和命令都使用生产实现。
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ top: 100, bottom: 120, left: 40, right: 60 });
  const app = createApp({ render: () => h('div', [
    h(FloatingToolbarContainer),
    h(FloatingToolbar, { show: true, position: { top: 20, left: 20 }, 'data-other-owner': '' }, {
      default: () => h('button', 'Other owner'),
    }),
  ]) });
  app.mount(toolbarHost);
  dispose = () => { app.unmount(); editor.destroy(); editorHost.remove(); toolbarHost.remove(); };
  editor.commands.setTextSelection({ from: 1, to: 6 });
  await nextTick();
  const format = toolbarHost.querySelector('[data-editor-floating-toolbar] button');
  const other = toolbarHost.querySelector('[data-other-owner] button');
  if (!(format instanceof HTMLButtonElement) || !(other instanceof HTMLButtonElement)) throw new Error('Missing toolbar buttons');
  expect(format.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))).toBe(false);
  expect(floatingToolbarService.state.isOpen).toBe(true);
  format.click();
  expect(editor.state.selection.from).toBe(1);
  expect(editor.state.selection.to).toBe(6);
  expect(editor.isActive('bold')).toBe(true);
  other.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await nextTick();
  expect(floatingToolbarService.state.isOpen).toBe(false);
  expect(toolbarHost.querySelector('[data-other-owner] button')).toBe(other);
});
