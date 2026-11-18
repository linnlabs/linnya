// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createApp, h } from 'vue';
import { CommandBar, ToolbarButton, ToolbarGroup } from '../src';

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

it('命令条只提供表面：toolbar 角色，调用方的 class、aria 与事件落在根元素', () => {
  const host = document.createElement('div');
  document.body.append(host);
  let pointerDowns = 0;
  const app = createApp({
    render: () => h(CommandBar, {
      class: 'caller-position', 'aria-label': 'Format', onPointerdown: () => { pointerDowns += 1; },
    }, { default: () => h(ToolbarGroup, {}, { default: () => h(ToolbarButton, { label: 'Bold' }, { default: () => 'B' }) }) }),
  });
  app.mount(host);
  dispose = () => { app.unmount(); host.remove(); };

  const bar = host.querySelector('.linnya-command-bar');
  expect(bar?.getAttribute('role')).toBe('toolbar');
  expect(bar?.getAttribute('aria-label')).toBe('Format');
  expect(bar?.classList.contains('caller-position')).toBe(true);
  bar?.dispatchEvent(new Event('pointerdown'));
  expect(pointerDowns).toBe(1);
  expect(bar?.querySelector('.linnya-toolbar-group button')).not.toBeNull();
});
