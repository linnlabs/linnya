// @vitest-environment jsdom

import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../subrun-card/ui/SubrunCard.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'SubrunCardStub',
      props: {
        subrunId: { type: String, required: true },
        expansionState: { type: String, required: true },
        hasNext: { type: Boolean, required: true },
      },
      emits: ['expanded-change'],
      setup(props, { emit }) {
        return () =>
          h('button', {
            class: 'subrun-card-stub',
            'data-subrun-id': props.subrunId,
            'data-expansion-state': props.expansionState,
            'data-has-next': String(props.hasNext),
            onClick: () => emit('expanded-change', props.expansionState !== 'expanded'),
          });
      },
    }),
  };
});

import SubrunCollection from '../ui/SubrunCollection.vue';

describe('SubrunCollection', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('把多个 subrun 保持在一个 collection 内，并且同时最多展开一个', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const items = ['subrun-a', 'subrun-b', 'subrun-c'].map(subrunId => ({
      subrunId,
      presentation: {
        status: 'loading' as const,
        data: { description: subrunId, subrunId, status: 'loading' as const },
      },
    }));
    const app = createApp(SubrunCollection, { items });
    app.use(createPinia());

    app.mount(container);
    await nextTick();
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.subrun-card-stub'));
    expect(buttons.map(button => button.dataset.subrunId)).toEqual([
      'subrun-a',
      'subrun-b',
      'subrun-c',
    ]);
    expect(buttons.map(button => button.dataset.hasNext)).toEqual(['true', 'true', 'false']);

    buttons[0]?.click();
    await nextTick();
    expect(buttons.map(button => button.dataset.expansionState)).toEqual([
      'expanded',
      'collapsed',
      'collapsed',
    ]);

    buttons[1]?.click();
    await nextTick();
    expect(buttons.map(button => button.dataset.expansionState)).toEqual([
      'collapsed',
      'expanded',
      'collapsed',
    ]);

    app.unmount();
  });

  it('每个 subrun 入场结束后立即清理自己的动画状态', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const items = ['subrun-a', 'subrun-b'].map(subrunId => ({
      subrunId,
      presentation: {
        status: 'loading' as const,
        data: { description: subrunId, subrunId, status: 'loading' as const },
      },
    }));
    const app = createApp(SubrunCollection, { items, animateEntry: true });
    app.use(createPinia());

    app.mount(container);
    await nextTick();
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.subrun-card-stub'));
    expect(buttons[0]?.classList.contains('subrun-collection__item--entering')).toBe(true);
    expect(buttons[1]?.classList.contains('subrun-collection__item--entering')).toBe(true);

    buttons[0]?.dispatchEvent(new Event('animationend'));
    await nextTick();

    expect(buttons[0]?.classList.contains('subrun-collection__item--entering')).toBe(false);
    expect(buttons[0]?.style.getPropertyValue('--subrun-collection-entry-delay')).toBe('');
    expect(buttons[1]?.classList.contains('subrun-collection__item--entering')).toBe(true);

    app.unmount();
  });
});
