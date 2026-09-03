// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUserScrollGesture } from './useUserScrollGesture';

describe('useUserScrollGesture', () => {
  let app: App<Element> | null = null;

  afterEach(() => {
    app?.unmount();
    app = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  async function mountGesture() {
    let now = 0;
    vi.spyOn(globalThis.performance, 'now').mockImplementation(() => now);
    const elementRef = ref<HTMLElement | null>(null);
    const holder: { isGestureActive?: () => boolean } = {};
    const Host = defineComponent({
      setup() {
        holder.isGestureActive = useUserScrollGesture(elementRef).isGestureActive;
        return () => h('div', { ref: elementRef, tabindex: 0 });
      },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    app = createApp(Host);
    app.mount(container);
    await nextTick();
    const element = elementRef.value;
    const isGestureActive = holder.isGestureActive;
    if (!element || !isGestureActive) throw new Error('gesture harness did not mount');
    return {
      element,
      isGestureActive,
      setNow: (value: number) => { now = value; },
    };
  }

  it('keeps wheel, touch and navigation-key intent active for the 250ms inertia window', async () => {
    const fixture = await mountGesture();
    expect(fixture.isGestureActive()).toBe(false);

    fixture.setNow(100);
    fixture.element.dispatchEvent(new WheelEvent('wheel'));
    fixture.setNow(350);
    expect(fixture.isGestureActive()).toBe(true);
    fixture.setNow(351);
    expect(fixture.isGestureActive()).toBe(false);

    fixture.setNow(500);
    fixture.element.dispatchEvent(new Event('touchmove'));
    expect(fixture.isGestureActive()).toBe(true);

    fixture.setNow(800);
    fixture.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(fixture.isGestureActive()).toBe(false);
    fixture.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(fixture.isGestureActive()).toBe(true);
  });

  it('keeps scrollbar dragging active until the global pointerup', async () => {
    const fixture = await mountGesture();
    fixture.setNow(100);
    fixture.element.dispatchEvent(new Event('pointerdown'));
    fixture.setNow(1_000);
    expect(fixture.isGestureActive()).toBe(true);

    globalThis.window.dispatchEvent(new Event('pointerup'));
    expect(fixture.isGestureActive()).toBe(false);
  });
});
