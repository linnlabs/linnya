// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { DraggablePanel } from '@linnya/renderer-ui';

const mountedApps: Array<{ readonly app: App; readonly host: HTMLDivElement }> = [];
let closeCount = 0;

function mountPanel(props: Record<string, unknown> = {}): HTMLDivElement {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({
    render: () => h(
      DraggablePanel,
      {
        visible: true,
        width: '400px',
        height: '300px',
        onClose: () => { closeCount += 1; },
        ...props,
      },
      {
        title: () => '面板标题',
        default: () => h('div', '面板内容'),
      },
    ),
  });
  app.mount(host);
  mountedApps.push({ app, host });
  return host;
}

beforeEach(() => {
  closeCount = 0;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1_000 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
});

afterEach(() => {
  while (mountedApps.length > 0) {
    const mounted = mountedApps.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
});

describe('DraggablePanel', () => {
  it('保留初始位置、slot、关闭事件、原生属性与公开节点 class 扩展', async () => {
    const host = mountPanel({
      'data-mm-interactive': 'true',
      classNames: {
        header: 'business-panel-header',
        title: 'business-panel-title',
        closeButton: 'business-panel-close',
        body: 'business-panel-body',
      },
    });
    await nextTick();

    const panel = host.querySelector<HTMLElement>('.draggable-panel');
    expect(panel?.style.left).toBe('300px');
    expect(panel?.style.top).toBe('250px');
    expect(panel?.getAttribute('data-mm-interactive')).toBe('true');
    expect(panel?.querySelector('.business-panel-header')).not.toBeNull();
    expect(panel?.querySelector('.business-panel-title')?.textContent).toBe('面板标题');
    expect(panel?.querySelector('.business-panel-body')?.textContent).toBe('面板内容');
    expect(panel?.querySelectorAll('.resize-handle')).toHaveLength(8);

    panel?.querySelector<HTMLButtonElement>('.business-panel-close')?.click();
    expect(closeCount).toBe(1);
  });

  it('拖拽时阻止宿主收到起手事件，并把面板约束在视口内', async () => {
    const host = mountPanel();
    await nextTick();
    const panel = host.querySelector<HTMLElement>('.draggable-panel');
    const header = host.querySelector<HTMLElement>('.panel-header');
    let hostMouseDownCount = 0;
    host.addEventListener('mousedown', () => { hostMouseDownCount += 1; });

    header?.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientX: 350,
      clientY: 275,
    }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: -100, clientY: -100 }));
    document.dispatchEvent(new MouseEvent('mouseup'));
    await nextTick();

    expect(hostMouseDownCount).toBe(0);
    expect(panel?.style.left).toBe('0px');
    expect(panel?.style.top).toBe('0px');
  });

  it('auto 高度保持横向 resize 手柄并隐藏纵向与角落手柄', async () => {
    const host = mountPanel({ height: 'auto' });
    await nextTick();
    const panel = host.querySelector<HTMLElement>('.draggable-panel');

    expect(panel?.style.height).toBe('auto');
    expect(panel?.querySelector('.resize-e')).not.toBeNull();
    expect(panel?.querySelector('.resize-w')).not.toBeNull();
    expect(panel?.querySelector('.resize-n')).toBeNull();
    expect(panel?.querySelector('.resize-s')).toBeNull();
    expect(panel?.querySelector('.resize-se')).toBeNull();
  });
});
