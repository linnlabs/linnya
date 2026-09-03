// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TimelineNav from './TimelineNav.vue';
import type { TimelineMarker } from '../../../features/timeline';
import { conversationVisualTurnIdFromUserMessageId } from '@app/schemas';

const markers: TimelineMarker[] = [
  { visualTurnId: conversationVisualTurnIdFromUserMessageId('user-1'), turnIndex: 0, summary: '第一轮', anchorMessageId: 'user-1', sortSeq: 1 },
  { visualTurnId: conversationVisualTurnIdFromUserMessageId('user-2'), turnIndex: 1, summary: '第二轮', anchorMessageId: 'user-2', sortSeq: 3 },
];

function createMarkers(count: number): TimelineMarker[] {
  return Array.from({ length: count }, (_, index) => ({
    visualTurnId: conversationVisualTurnIdFromUserMessageId(`user-${String(index + 1)}`),
    turnIndex: index,
    summary: `第 ${String(index + 1)} 轮`,
    anchorMessageId: `user-${String(index + 1)}`,
    sortSeq: index,
  }));
}

async function flushDomUpdates(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe('TimelineNav', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('keeps timeline markers mounted while the timeline is collapsed', async () => {
    const isCollapsed = ref(true);
    const scrollContainer = document.createElement('div');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const app = createApp(defineComponent({
      setup() {
        return () => h(TimelineNav, {
          markers,
          isCollapsed: isCollapsed.value,
          scrollContainer,
        });
      },
    }));

    app.mount(container);
    await flushDomUpdates();

    const collapsedNav = container.querySelector('.timeline-nav');
    const collapsedDots = Array.from(container.querySelectorAll<HTMLButtonElement>('.timeline-dot'));
    expect(collapsedNav?.classList.contains('is-collapsed')).toBe(true);
    expect(collapsedNav?.getAttribute('aria-hidden')).toBe('true');
    expect(collapsedDots).toHaveLength(2);
    expect(collapsedDots.every((dot) => dot.disabled)).toBe(true);

    isCollapsed.value = false;
    await flushDomUpdates();

    const expandedNav = container.querySelector('.timeline-nav');
    const expandedDots = Array.from(container.querySelectorAll<HTMLButtonElement>('.timeline-dot'));
    expect(expandedNav?.classList.contains('is-collapsed')).toBe(false);
    expect(expandedNav?.hasAttribute('aria-hidden')).toBe(false);
    expect(expandedDots).toHaveLength(2);
    expect(expandedDots.every((dot) => dot.disabled)).toBe(false);

    app.unmount();
  });

  it('renders a scrollable window instead of mounting every overflow marker', async () => {
    const container = document.createElement('div');
    let bubbledWheelCount = 0;
    container.addEventListener('wheel', () => {
      bubbledWheelCount += 1;
    });
    document.body.appendChild(container);

    const app = createApp(defineComponent({
      setup() {
        return () => h(TimelineNav, {
          markers: createMarkers(5_000),
          isCollapsed: false,
          scrollContainer: document.createElement('div'),
        });
      },
    }));

    app.mount(container);
    await flushDomUpdates();

    const track = container.querySelector<HTMLElement>('.timeline-track');
    const initialDots = Array.from(container.querySelectorAll<HTMLButtonElement>('.timeline-dot'));
    expect(track?.classList.contains('is-overflow')).toBe(true);
    expect(initialDots.length).toBeLessThan(5_000);
    expect(initialDots[0]?.getAttribute('aria-label')).toBe('第 1 轮');

    if (!track) throw new Error('timeline track should be mounted');
    track.scrollTop = 1_000;
    track.dispatchEvent(new Event('scroll'));
    await flushDomUpdates();
    const scrolledDots = Array.from(container.querySelectorAll<HTMLButtonElement>('.timeline-dot'));
    expect(scrolledDots[0]?.getAttribute('aria-label')).not.toBe('第 1 轮');

    track.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    expect(bubbledWheelCount).toBe(0);
    app.unmount();
  });
});
