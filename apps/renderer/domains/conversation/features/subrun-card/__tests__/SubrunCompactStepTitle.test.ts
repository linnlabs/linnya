// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationToolMessageStatus } from '@app/schemas';

import SubrunCompactStepTitle from '../ui/SubrunCompactStepTitle.vue';

vi.mock('@app/localization', () => ({
  useLocalization: () => ({
    t: (descriptor: string | { fallback?: string; key?: string }) => (
      typeof descriptor === 'string' ? descriptor : descriptor.fallback ?? descriptor.key ?? ''
    ),
  }),
}));

describe('SubrunCompactStepTitle', () => {
  let app: App<Element> | null = null;

  afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
  });

  it('首步之前显示原始标题并扫光，终态恢复静态原始标题', async () => {
    const status = ref<ConversationToolMessageStatus>('loading');
    const mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    app = createApp(defineComponent({
      setup: () => () => h(SubrunCompactStepTitle, {
        fallbackTitle: '分析行业竞争格局',
        status: status.value,
      }),
    }));
    app.mount(mountPoint);

    expect(mountPoint.textContent).toContain('分析行业竞争格局');
    expect(mountPoint.querySelector('.tool-card__name-text--active')).not.toBeNull();

    status.value = 'success';
    await nextTick();
    expect(mountPoint.textContent).toContain('分析行业竞争格局');
    expect(mountPoint.querySelector('.tool-card__name-text--active')).toBeNull();
  });
});
