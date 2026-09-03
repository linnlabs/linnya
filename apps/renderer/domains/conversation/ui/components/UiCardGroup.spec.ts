// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationCardGroupHeader } from '../../definitions/conversationPresentation';
import UiCardGroup from './UiCardGroup.vue';

vi.mock('../Message.vue', () => ({
  default: {
    name: 'MessageStub',
    template: '<div class="message-stub" />',
  },
}));

vi.mock('../useConversationLocalization', () => ({
  useConversationLocalization: () => ({
    currentLocale: { value: 'zh-CN' },
    conversationMessage: (key: string) => key,
  }),
}));

function createHeader(): ConversationCardGroupHeader {
  return {
    id: 'task-header',
    collapsedByDefault: true,
    headerText: '子任务',
  };
}

describe('UiCardGroup manual expansion', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('stays collapsed by default and never lets running state override a user choice', async () => {
    const isActive = ref(false);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp(defineComponent({
      setup() {
        return () => h(UiCardGroup, {
          header: createHeader(),
          children: [],
          isActive: isActive.value,
        });
      },
    }));

    app.mount(container);
    await nextTick();
    expect(container.querySelector('.ui-card-group > .content-wrapper > .ui-card-header')).not.toBeNull();
    expect(container.querySelector('.ui-card-body')).toBeNull();

    isActive.value = true;
    await nextTick();
    expect(container.querySelector('.ui-card-body')).toBeNull();

    container.querySelector<HTMLElement>('.ui-card-header')?.click();
    await nextTick();
    expect(container.querySelector('.ui-card-body')).not.toBeNull();

    isActive.value = false;
    await nextTick();
    expect(container.querySelector('.ui-card-body')).not.toBeNull();

    app.unmount();
  });

  it('uses an immediate bounded body for nested dynamic task content', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp(defineComponent({
      setup() {
        return () => h(UiCardGroup, {
          header: createHeader(),
          children: [],
          bounded: true,
        });
      },
    }));

    app.mount(container);
    container.querySelector<HTMLElement>('.ui-card-header')?.click();
    await nextTick();

    const body = container.querySelector<HTMLElement>('.ui-card-body');
    expect(body?.classList.contains('ui-card-body--bounded')).toBe(true);
    expect(body?.style.height).toBe('');

    app.unmount();
  });

  it('展开且没有 child 时渲染 owner 提供的明确空态', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp(defineComponent({
      setup() {
        return () => h(UiCardGroup, {
          header: createHeader(),
          children: [],
        }, {
          empty: () => h('div', { class: 'owner-empty-state' }, 'loading-or-empty'),
        });
      },
    }));

    app.mount(container);
    container.querySelector<HTMLElement>('.ui-card-header')?.click();
    await nextTick();

    expect(container.querySelector('.owner-empty-state')?.textContent).toBe('loading-or-empty');
    app.unmount();
  });

  it('allows a collection owner to control expansion without changing the default mode', async () => {
    const expansionState = ref<'expanded' | 'collapsed'>('collapsed');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp(defineComponent({
      setup() {
        return () => h(UiCardGroup, {
          header: createHeader(),
          children: [],
          bounded: true,
          expansionState: expansionState.value,
          'onExpanded-change': (expanded: boolean) => {
            expansionState.value = expanded ? 'expanded' : 'collapsed';
          },
        });
      },
    }));

    app.mount(container);
    await nextTick();
    expect(container.querySelector('.ui-card-body')).toBeNull();

    container.querySelector<HTMLElement>('.ui-card-header')?.click();
    await nextTick();
    expect(expansionState.value).toBe('expanded');
    expect(container.querySelector('.ui-card-body')).not.toBeNull();

    container.querySelector<HTMLElement>('.ui-card-header')?.click();
    await nextTick();
    expect(expansionState.value).toBe('collapsed');
    expect(container.querySelector('.ui-card-body')).toBeNull();

    app.unmount();
  });
});
