// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import { Modal } from '@linnya/renderer-ui';

const mountedApps: Array<{ readonly app: App; readonly host: HTMLDivElement }> = [];

function mountModal(render: () => ReturnType<typeof h>): void {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({ render });
  app.mount(host);
  mountedApps.push({ app, host });
}

afterEach(() => {
  while (mountedApps.length > 0) {
    const mounted = mountedApps.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
  document.body.querySelectorAll('.modal-overlay').forEach(overlay => overlay.remove());
});

describe('Modal', () => {
  it('默认由内容区滚动，动态正文增长时 footer 仍位于滚动区之外', async () => {
    const items = ref(['第一项']);
    mountModal(() => h(
      Modal,
      { isVisible: true, title: '动态表单' },
      {
        default: () => h('ul', items.value.map(item => h('li', { key: item }, item))),
        footer: () => h('button', { type: 'button' }, '保存'),
      }
    ));
    await nextTick();

    const content = document.body.querySelector<HTMLElement>('.modal-content');
    const footerButton = document.body.querySelector<HTMLButtonElement>('.modal-footer button');
    expect(content?.classList.contains('modal-content--content')).toBe(true);
    expect(footerButton?.textContent).toBe('保存');
    expect(content?.contains(footerButton ?? null)).toBe(false);

    items.value = Array.from({ length: 40 }, (_, index) => `动态项 ${index + 1}`);
    await nextTick();
    expect(content?.querySelectorAll('li')).toHaveLength(40);
  });

  it('internal 模式只提供受约束空间，由业务列表承担滚动', async () => {
    mountModal(() => h(
      Modal,
      {
        isVisible: true,
        title: '任务日志',
        height: '640px',
        scrollMode: 'internal',
      },
      {
        default: () => h('div', { class: 'business-log-scroll-owner' }, '日志内容'),
      }
    ));
    await nextTick();

    const content = document.body.querySelector<HTMLElement>('.modal-content');
    const container = document.body.querySelector<HTMLElement>('.modal-container');
    expect(content?.classList.contains('modal-content--internal')).toBe(true);
    expect(content?.classList.contains('modal-content--content')).toBe(false);
    expect(content?.querySelector('.business-log-scroll-owner')).not.toBeNull();
    expect(container?.style.height).toBe('640px');
    expect(container?.style.maxHeight).toContain('100dvh');
  });

  it('严格遵守遮罩与 Escape 两个关闭开关', async () => {
    let closeCount = 0;
    mountModal(() => h(Modal, {
      isVisible: true,
      closeOnOverlayClick: false,
      closeOnEsc: false,
      onClose: () => { closeCount += 1; },
    }));
    await nextTick();

    const overlay = document.body.querySelector<HTMLElement>('.modal-overlay');
    overlay?.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closeCount).toBe(0);

    document.body.querySelector<HTMLButtonElement>('.modal-close')?.click();
    expect(closeCount).toBe(1);
  });
});
