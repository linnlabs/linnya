// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import { FloatingToolbar, ToolbarGroup } from '../src';

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

it('独立工具条保留表单输入行为，选区保留由调用方显式提供', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const show = ref(true);
  const inputValue = ref('24');
  let commands = 0;
  const app = createApp({
    render: () => h('div', [
      h(FloatingToolbar, {
        show: true, position: { top: 10, left: 20 }, 'data-editor-floating-toolbar': '',
        onMousedown: (event: MouseEvent) => event.preventDefault(),
      }, { default: () => h('button', { onClick: () => { commands += 1; } }, 'Format') }),
      h(FloatingToolbar, {
        show: show.value, position: { top: 30, left: 40 }, 'aria-label': 'Properties',
      }, { default: () => h(ToolbarGroup, {}, { default: () => h('input', {
        value: inputValue.value,
        onInput: (event: Event) => {
          if (event.target instanceof HTMLInputElement) inputValue.value = event.target.value;
        },
      }) }) }),
    ]),
  });
  app.mount(host);
  dispose = () => { app.unmount(); host.remove(); };
  const input = host.querySelector('input');
  const button = host.querySelector('button');
  if (!input || !button) throw new Error('Missing toolbar controls');
  expect(input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))).toBe(true);
  input.focus();
  input.value = '36';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(document.activeElement).toBe(input);
  expect(inputValue.value).toBe('36');
  expect(button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))).toBe(false);
  button.click();
  expect(commands).toBe(1);
  show.value = false;
  await nextTick();
  expect(host.querySelector('input')).toBeNull();
  expect(host.querySelector('button')).toBe(button);
});
