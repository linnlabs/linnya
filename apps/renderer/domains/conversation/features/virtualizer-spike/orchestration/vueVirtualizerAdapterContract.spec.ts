// @vitest-environment jsdom

import { computed, createApp, defineComponent, h, nextTick, ref, type App } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import { useVirtualizer } from '@tanstack/vue-virtual';

describe('TanStack Vue virtualizer chat contract', () => {
  let app: App<Element> | null = null;

  afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
  });

  it('exposes end anchoring and the chat instance methods through the Vue adapter', async () => {
    const scrollerRef = ref<HTMLElement | null>(null);
    const ids = ref(['message-1', 'message-2']);
    const holder: {
      instance: ReturnType<typeof useVirtualizer<HTMLElement, HTMLElement>> | null;
    } = { instance: null };

    const Host = defineComponent({
      setup() {
        holder.instance = useVirtualizer<HTMLElement, HTMLElement>(computed(() => ({
          count: ids.value.length,
          getScrollElement: () => scrollerRef.value,
          estimateSize: () => 80,
          getItemKey: (index: number) => ids.value[index] ?? `missing-${index}`,
          anchorTo: 'end',
          followOnAppend: true,
          scrollEndThreshold: 1,
        })));
        return () => h('div', { ref: scrollerRef });
      },
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    app = createApp(Host);
    app.mount(container);
    await nextTick();

    const virtualizer = holder.instance?.value;
    expect(virtualizer?.options.anchorTo).toBe('end');
    expect(virtualizer?.options.followOnAppend).toBe(true);
    expect(virtualizer?.options.scrollEndThreshold).toBe(1);
    expect(typeof virtualizer?.scrollToEnd).toBe('function');
    expect(typeof virtualizer?.isAtEnd).toBe('function');
    expect(typeof virtualizer?.getDistanceFromEnd).toBe('function');
  });
});
