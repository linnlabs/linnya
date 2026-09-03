// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, createVNode, h, nextTick, ref, Teleport } from 'vue';
import { BaseDropdown } from '../src';

interface MountedDropdown {
  readonly host: HTMLElement;
  readonly unmount: () => void;
}

function mountDropdown(): MountedDropdown {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const app = createApp({
    setup() {
      const panelRef = ref<HTMLElement | null>(null);
      return () => h(BaseDropdown, { externalContentRef: panelRef.value }, {
        trigger: ({ toggle, isOpen }: {
          readonly toggle: (event?: Event) => void;
          readonly isOpen: boolean;
        }) => h('button', {
          type: 'button',
          'data-testid': 'trigger',
          'aria-expanded': String(isOpen),
          onClick: toggle,
        }, 'open'),
        content: ({ isOpen }: { readonly isOpen: boolean }) => createVNode(Teleport, { to: 'body' }, [
          isOpen
            ? h('button', {
              ref: panelRef,
              type: 'button',
              'data-testid': 'panel',
            }, 'panel')
            : null,
        ]),
      });
    },
  });
  app.mount(host);

  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

const mountedDropdowns: MountedDropdown[] = [];

afterEach(() => {
  while (mountedDropdowns.length > 0) mountedDropdowns.pop()?.unmount();
});

describe('BaseDropdown 弹出菜单交互', () => {
  it('Teleport 面板内点击保持打开，点击外部关闭', async () => {
    const mounted = mountDropdown();
    mountedDropdowns.push(mounted);
    const trigger = mounted.host.querySelector('[data-testid="trigger"]');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('trigger not found');

    trigger.click();
    await nextTick();
    const panel = document.body.querySelector('[data-testid="panel"]');
    if (!(panel instanceof HTMLButtonElement)) throw new Error('panel not found');

    panel.click();
    await nextTick();
    expect(document.body.querySelector('[data-testid="panel"]')).toBe(panel);

    document.body.click();
    await nextTick();
    expect(document.body.querySelector('[data-testid="panel"]')).toBeNull();
  });

  it('Escape 关闭并把焦点还给打开菜单的触发器', async () => {
    const mounted = mountDropdown();
    mountedDropdowns.push(mounted);
    const trigger = mounted.host.querySelector('[data-testid="trigger"]');
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('trigger not found');

    trigger.focus();
    trigger.click();
    await nextTick();
    const panel = document.body.querySelector('[data-testid="panel"]');
    if (!(panel instanceof HTMLButtonElement)) throw new Error('panel not found');
    panel.focus();

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await nextTick();

    expect(document.body.querySelector('[data-testid="panel"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
