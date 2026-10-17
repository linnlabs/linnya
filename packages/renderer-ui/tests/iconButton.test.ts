// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, ref, type App } from 'vue';
import { IconButton, resolveIconButtonElement, type IconButtonExposed, type IconButtonProps } from '@linnya/renderer-ui';

const mountedApps: Array<{ readonly app: App; readonly host: HTMLDivElement }> = [];

function mountIconButton(props: IconButtonProps & Record<string, unknown>): HTMLButtonElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(IconButton, props, { default: () => h('svg', { 'data-icon': 'close' }) }),
  });
  app.mount(host);
  mountedApps.push({ app, host });
  const button = host.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error('IconButton root not found');
  return button;
}

afterEach(() => {
  while (mountedApps.length > 0) {
    const mounted = mountedApps.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
});

describe('IconButton', () => {
  it('label 同时作为可访问名称与原生提示，默认 type=button', () => {
    const button = mountIconButton({ label: '关闭' });

    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('关闭');
    expect(button.title).toBe('关闭');
    expect(button.querySelector('[data-icon="close"]')).not.toBeNull();
  });

  it('外层已有自定义提示时可以关闭原生 title', () => {
    const button = mountIconButton({ label: '设置', tooltip: false });

    expect(button.getAttribute('aria-label')).toBe('设置');
    expect(button.hasAttribute('title')).toBe(false);
  });

  it('默认是 sm ghost，并按 props 投影唯一的视觉修饰类', () => {
    expect([...mountIconButton({ label: '更多' }).classList]).toEqual([
      'linnya-ui-icon-button',
      'linnya-ui-icon-button--sm',
      'linnya-ui-icon-button--ghost',
    ]);
    expect([...mountIconButton({ label: '删除', size: 'xs', variant: 'subtle', tone: 'danger', active: true }).classList]).toEqual([
      'linnya-ui-icon-button',
      'linnya-ui-icon-button--xs',
      'linnya-ui-icon-button--subtle',
      'linnya-ui-icon-button--danger',
      'linnya-ui-icon-button--active',
    ]);
  });

  it('overlay 变体只多一个修饰类，active 仍由 active 类表达', () => {
    expect([...mountIconButton({ label: '放大', variant: 'overlay', active: true }).classList]).toEqual([
      'linnya-ui-icon-button',
      'linnya-ui-icon-button--sm',
      'linnya-ui-icon-button--overlay',
      'linnya-ui-icon-button--active',
    ]);
  });

  it('属性、class 与事件落在原生按钮上，disabled 阻止点击', () => {
    let clicks = 0;
    const button = mountIconButton({
      label: '历史',
      class: 'consumer-class',
      'aria-expanded': 'true',
      onClick: () => { clicks += 1; },
    });
    button.click();
    expect(clicks).toBe(1);
    expect(button.classList.contains('consumer-class')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    const disabled = mountIconButton({ label: '刷新', disabled: true, onClick: () => { clicks += 1; } });
    disabled.click();
    expect(disabled.disabled).toBe(true);
    expect(clicks).toBe(1);
  });

  it('暴露原生按钮元素，供浮层定位使用', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const instance = ref<IconButtonExposed | null>(null);
    const app = createApp({
      render: () => h(IconButton, { label: '历史', ref: instance }, { default: () => h('svg') }),
    });
    app.mount(host);
    mountedApps.push({ app, host });

    expect(instance.value?.element).toBe(host.querySelector('button'));
  });

  it('resolveIconButtonElement 同时接受原生按钮与组件实例，其余输入返回 null', () => {
    const button = document.createElement('button');
    expect(resolveIconButtonElement(button)).toBe(button);
    expect(resolveIconButtonElement({ element: button })).toBe(button);
    expect(resolveIconButtonElement({ element: document.createElement('div') })).toBeNull();
    expect(resolveIconButtonElement(document.createElement('div'))).toBeNull();
    expect(resolveIconButtonElement(null)).toBeNull();
  });
});
