// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SubrunTracePanel from './SubrunTracePanel.vue';

vi.mock('../../../ui/useConversationLocalization', () => ({
  useConversationLocalization: () => ({
    currentLocale: { value: 'zh-CN' },
    conversationMessage: (key: string) => key,
  }),
}));

describe('SubrunTracePanel manual expansion', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('stays folded across status changes until the user expands it', async () => {
    const status = ref('loading');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp(defineComponent({
      setup() {
        return () => h(SubrunTracePanel, {
          status: status.value,
          enabled: true,
          disclosureMode: 'collapsible',
          subrunTraceVersion: 1,
          subrunTrace: {
            'subrun-1': {
              subrun_id: 'subrun-1',
              events: [{
                type: 'subrun_trace',
                id: 'tool-process-1',
                conversation_id: 'conv-1',
                turn_id: 'turn-1',
                timestamp: 1,
                version: 1,
                parent_tool_call_id: 'parent-1',
                subrun_id: 'subrun-1',
                source_event_id: 'child-tool-process-1',
                kind: 'tool_process',
                tool_name: 'search',
                tool_call_id: 'search-1',
                phase: 'start',
                status: 'loading',
                args: {},
              }],
            },
          },
        });
      },
    }));
    app.use(createPinia());

    app.mount(container);
    await nextTick();
    await Promise.resolve();
    const body = container.querySelector<HTMLElement>('.deep-trace__body');
    expect(body?.style.display).toBe('none');

    status.value = 'success';
    await nextTick();
    expect(body?.style.display).toBe('none');

    container.querySelector<HTMLElement>('.deep-trace__header')?.click();
    await nextTick();
    expect(body?.style.display).toBe('');

    status.value = 'loading';
    await nextTick();
    expect(body?.style.display).toBe('');

    app.unmount();
  });

  it.each(['loading', 'success'])('只有 thought 的 bucket 在 %s 时不伪造过程或占位内容', async (status) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp(defineComponent({
      setup() {
        return () => h(SubrunTracePanel, {
          status,
          enabled: true,
          disclosureMode: 'collapsible',
          subrunTraceVersion: 1,
          subrunTrace: {
            'subrun-1': {
              subrun_id: 'subrun-1',
              events: [{
                type: 'subrun_trace',
                id: 'thought-1',
                conversation_id: 'conv-1',
                turn_id: 'turn-1',
                timestamp: 1,
                version: 1,
                parent_tool_call_id: 'parent-1',
                subrun_id: 'subrun-1',
                source_event_id: 'child-thought-1',
                kind: 'thought_delta',
                delta: 'thinking',
              }],
            },
          },
        });
      },
    }));
    app.use(createPinia());

    app.mount(container);
    container.querySelector<HTMLElement>('.deep-trace__header')?.click();
    await nextTick();

    expect(container.querySelector('.deep-trace__body')).toBeNull();
    expect(container.querySelector('.deep-trace__meta')).toBeNull();
    app.unmount();
  });

  it('允许普通 subrun 常驻展示过程并通过 action slot 导航，不暴露折叠操作', async () => {
    const onAction = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp(defineComponent({
      setup() {
        return () => h(SubrunTracePanel, {
          status: 'error',
          enabled: true,
          disclosureMode: 'static-expanded',
          subrunTraceVersion: 1,
          subrunTrace: {
            'subrun-1': {
              subrun_id: 'subrun-1',
              events: [],
            },
          },
        }, {
          actions: () => h('button', {
            class: 'fixture-detail-action',
            onClick: onAction,
          }, '详情'),
        });
      },
    }));
    app.use(createPinia());

    app.mount(container);
    await nextTick();
    const body = container.querySelector<HTMLElement>('.deep-trace__body');
    expect(body).toBeNull();
    expect(container.querySelector('.deep-trace__toggle')).toBeNull();

    container.querySelector<HTMLElement>('.deep-trace__header')?.click();
    await nextTick();
    expect(container.querySelector('.deep-trace__body')).toBeNull();

    container.querySelector<HTMLButtonElement>('.fixture-detail-action')?.click();
    await nextTick();

    expect(onAction).toHaveBeenCalledOnce();
    expect(container.querySelector('.deep-trace__body')).toBeNull();
    app.unmount();
  });
});
