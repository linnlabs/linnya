// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import { BaseDropdown, DropdownPanel, ToolbarColorButton } from '../src';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); vi.useRealTimers(); });

it('共享颜色入口保留输入焦点、嵌套 Escape 和外部点击；关闭动画不可继续操作', async () => {
  vi.useFakeTimers();
  const host = document.createElement('div');
  const outside = document.createElement('button');
  document.body.append(host, outside);
  const draftOpen = ref(false);
  const open = ref(false);
  const app = createApp({ render: () => h(BaseDropdown, { manualMode: true, isOpen: open.value,
    onOpen: () => { open.value = true; }, onClose: () => { open.value = false; },
  }, {
    trigger: ({ toggle, isOpen }: { toggle: (event?: Event) => void; isOpen: boolean }) => h(ToolbarColorButton, {
      kind: 'text', color: '#000000', label: 'Text color', expanded: isOpen, onClick: toggle,
    }),
    content: ({ isOpen }: { isOpen: boolean }) => h(DropdownPanel, { show: isOpen }, {
      default: () => h('input', { onKeydown: (event: KeyboardEvent) => {
        if (event.key === 'Escape' && draftOpen.value) {
          event.stopPropagation(); draftOpen.value = false;
        }
      } }),
    }),
  }) });
  app.mount(host);
  dispose = () => { app.unmount(); host.remove(); outside.remove(); };
  const trigger = host.querySelector('button');
  if (!trigger) throw new Error('Missing shared trigger');
  trigger.click(); await nextTick();
  const input = host.querySelector('input');
  if (!input) throw new Error('Missing dropdown input');
  input.focus(); input.click();
  expect(document.activeElement).toBe(input);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  draftOpen.value = true;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(draftOpen.value).toBe(false);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  const panel = input.parentElement;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextTick(); await nextTick();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  expect(panel?.inert).toBe(true);
  // 未等退出动画结束即重新打开，不能残留 inert 或旧关闭状态。
  trigger.click(); await nextTick();
  expect(host.querySelector('input')?.parentElement?.inert).toBe(false);
  outside.focus(); outside.click(); await nextTick();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(outside);
});
