// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, type App } from 'vue';
import { BaseButton, type BaseButtonProps } from '@linnya/renderer-ui';

const mountedApps: Array<{ readonly app: App; readonly host: HTMLDivElement }> = [];

function mountButton(
  props: BaseButtonProps & Record<string, unknown> = {},
  slots: { readonly icon?: boolean } = {},
): HTMLButtonElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(BaseButton, props, {
      default: () => '新建',
      ...(slots.icon ? { icon: () => h('svg', { 'data-icon': 'add' }) } : {}),
    }),
  });
  app.mount(host);
  mountedApps.push({ app, host });
  const button = host.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) throw new Error('BaseButton root not found');
  return button;
}

afterEach(() => {
  while (mountedApps.length > 0) {
    const mounted = mountedApps.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
});

describe('BaseButton', () => {
  it('渲染原生 button，默认 type=button，并把属性与事件落在根节点', () => {
    let clicks = 0;
    const button = mountButton({
      'aria-label': '新建知识库',
      'data-owner': 'consumer',
      class: 'consumer-class',
      onClick: () => { clicks += 1; },
    });

    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('新建知识库');
    expect(button.dataset.owner).toBe('consumer');
    expect(button.classList.contains('consumer-class')).toBe(true);
    button.click();
    expect(clicks).toBe(1);
  });

  it('disabled 使用原生语义并阻止点击', () => {
    let clicks = 0;
    const button = mountButton({ disabled: true, onClick: () => { clicks += 1; } });

    button.click();
    expect(button.disabled).toBe(true);
    expect(clicks).toBe(0);
  });

  it('默认是小尺寸 secondary，并按 props 投影唯一的视觉修饰类', () => {
    expect([...mountButton().classList]).toEqual([
      'linnya-ui-button',
      'linnya-ui-button--secondary',
      'linnya-ui-button--sm',
    ]);

    const outline = mountButton({ variant: 'outline', tone: 'info', size: 'lg', shape: 'pill', block: true });
    expect([...outline.classList]).toEqual([
      'linnya-ui-button',
      'linnya-ui-button--outline',
      'linnya-ui-button--lg',
      'linnya-ui-button--tone-info',
      'linnya-ui-button--pill',
      'linnya-ui-button--block',
    ]);
  });

  it('tint 是独立的 variant，不带 tone', () => {
    const tint = mountButton({ variant: 'tint', size: 'lg', block: true, tone: 'info' });
    expect([...tint.classList]).toEqual([
      'linnya-ui-button',
      'linnya-ui-button--tint',
      'linnya-ui-button--lg',
      'linnya-ui-button--block',
    ]);
  });

  it('tone 只作用于 outline 与 plain', () => {
    const primary = mountButton({ variant: 'primary', tone: 'info' });
    expect(primary.classList.contains('linnya-ui-button--tone-info')).toBe(false);

    const plainDanger = mountButton({ variant: 'plain', tone: 'danger' });
    expect(plainDanger.classList.contains('linnya-ui-button--tone-danger')).toBe(true);

    const plainDefault = mountButton({ variant: 'plain' });
    expect(plainDefault.classList.contains('linnya-ui-button--tone-neutral')).toBe(true);
  });

  it('图标放入对辅助技术隐藏的槽位，文字仍是按钮的可访问名称', () => {
    const button = mountButton({ variant: 'outline', tone: 'accent' }, { icon: true });
    const icon = button.querySelector('.linnya-ui-button__icon');

    expect(button.classList.contains('linnya-ui-button--with-icon')).toBe(true);
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.querySelector('[data-icon="add"]')).not.toBeNull();
    expect(button.querySelector('.linnya-ui-button__label')?.textContent).toBe('新建');
  });
});
