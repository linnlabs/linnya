// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, type App } from 'vue';
import { Skeleton, SkeletonBlock, SkeletonRows } from '@linnya/renderer-ui';

const mountedApps: Array<{ readonly app: App; readonly host: HTMLDivElement }> = [];

function mount(render: () => ReturnType<typeof h>): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ render });
  app.mount(host);
  mountedApps.push({ app, host });
  return host;
}

afterEach(() => {
  while (mountedApps.length > 0) {
    const mounted = mountedApps.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
});

describe('Skeleton', () => {
  it('以 status 角色播报文案，形状对辅助技术隐藏，默认延迟出现', () => {
    const host = mount(() => h(Skeleton, { label: '正在加载项目' }, () => h(SkeletonBlock, { width: '60%' })));
    const root = host.querySelector('.linnya-ui-skeleton');

    expect(root?.getAttribute('role')).toBe('status');
    expect(root?.getAttribute('aria-busy')).toBe('true');
    expect(root?.classList.contains('linnya-ui-skeleton--delayed')).toBe(true);
    expect(host.querySelector('.linnya-ui-skeleton__label')?.textContent).toBe('正在加载项目');
    expect(host.querySelector('.linnya-ui-skeleton__content')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('delayed=false 时立即显示', () => {
    const host = mount(() => h(Skeleton, { label: '加载中', delayed: false }));
    expect(host.querySelector('.linnya-ui-skeleton')?.classList.contains('linnya-ui-skeleton--delayed')).toBe(false);
  });

  it('SkeletonBlock 投影尺寸与圆角', () => {
    const host = mount(() => h(SkeletonBlock, { width: '32px', height: '32px', radius: 'md' }));
    const block = host.querySelector<HTMLElement>('.linnya-ui-skeleton-block');

    expect(block?.style.width).toBe('32px');
    expect(block?.style.height).toBe('32px');
    expect(block?.classList.contains('linnya-ui-skeleton-block--radius-md')).toBe(true);
  });
});

describe('SkeletonRows', () => {
  it('按行数渲染，并按需加入图标与行尾占位', () => {
    const host = mount(() => h(SkeletonRows, { label: '正在加载对话', rows: 3, icon: true, trailing: true }));

    expect(host.querySelectorAll('.linnya-ui-skeleton-rows__row')).toHaveLength(3);
    expect(host.querySelectorAll('.linnya-ui-skeleton-rows__icon')).toHaveLength(3);
    expect(host.querySelectorAll('.linnya-ui-skeleton-rows__trailing')).toHaveLength(3);
    expect(host.querySelector('.linnya-ui-skeleton-rows--md')).not.toBeNull();
  });

  it('lg 为双行并使用 32px 图标，宽度序列稳定', () => {
    const render = () => h(SkeletonRows, { label: '正在加载插件', rows: 2, size: 'lg', icon: true });
    const first = mount(render);
    const second = mount(render);
    const widths = (host: HTMLDivElement) => [...host.querySelectorAll<HTMLElement>('.linnya-ui-skeleton-rows__text .linnya-ui-skeleton-block')].map(block => block.style.width);

    expect(first.querySelectorAll('.linnya-ui-skeleton-rows__row')[0]?.querySelectorAll('.linnya-ui-skeleton-rows__text .linnya-ui-skeleton-block')).toHaveLength(2);
    expect(first.querySelector<HTMLElement>('.linnya-ui-skeleton-rows__icon')?.style.width).toBe('32px');
    expect(widths(first)).toEqual(widths(second));
  });
});
