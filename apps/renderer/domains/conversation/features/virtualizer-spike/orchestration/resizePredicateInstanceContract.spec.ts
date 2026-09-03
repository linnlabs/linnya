// @vitest-environment jsdom

import { computed, createApp, defineComponent, h, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useVirtualizer } from '@tanstack/vue-virtual';

describe('TanStack resize predicate instance contract', () => {
  it('accepts and invokes the predicate assigned directly to the instance', async () => {
    const scrollerRef = ref<HTMLElement | null>(null);
    const holder: {
      instance: ReturnType<typeof useVirtualizer<HTMLElement, HTMLElement>> | null;
    } = { instance: null };

    const Host = defineComponent({
      setup() {
        holder.instance = useVirtualizer<HTMLElement, HTMLElement>(computed(() => ({
          count: 1,
          getScrollElement: () => scrollerRef.value,
          estimateSize: () => 80,
        })));
        return () => h('div', { ref: scrollerRef });
      },
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp(Host);
    app.mount(container);
    await nextTick();

    const virtualizer = holder.instance?.value;
    const predicate = vi.fn(() => true);
    if (!virtualizer) throw new Error('virtualizer instance was not created');
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange = predicate;

    const item = {
      index: 0,
      key: 0,
      start: 10,
      end: 90,
      size: 80,
      lane: 0,
    };
    expect(virtualizer.shouldAdjustScrollPositionOnItemSizeChange(item, 20, virtualizer)).toBe(true);
    expect(predicate).toHaveBeenCalledOnce();
    app.unmount();
  });
});
