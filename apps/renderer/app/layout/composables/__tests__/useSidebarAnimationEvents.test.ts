// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  createApp,
  defineComponent,
  h,
  nextTick,
  type App,
} from 'vue';
import { useUIStore } from '@/shared/stores/ui';
import { useSidebarAnimationEvents } from '../useSidebarAnimationEvents';

describe('useSidebarAnimationEvents', () => {
  let app: App<Element>;
  let container: HTMLElement;
  let events: string[];
  let emitSidebarTransitionEnd: (event: TransitionEvent) => void;

  const recordStart = () => events.push('start');
  const recordEnd = () => events.push('end');

  beforeEach(() => {
    setActivePinia(createPinia());
    events = [];
    window.addEventListener('sidebar-anim-start', recordStart);
    window.addEventListener('sidebar-anim-end', recordEnd);
    container = document.createElement('div');
    document.body.appendChild(container);
    app = createApp(defineComponent({
      setup() {
        ({ emitSidebarTransitionEnd } = useSidebarAnimationEvents());
        return () => h('div');
      },
    }));
    app.mount(container);
  });

  afterEach(() => {
    app.unmount();
    container.remove();
    document.body.classList.remove('panel-resizing');
    window.removeEventListener('sidebar-anim-start', recordStart);
    window.removeEventListener('sidebar-anim-end', recordEnd);
  });

  it('等待真实 margin transitionend', async () => {
    useUIStore().setSidebarVisible(false);
    await nextTick();

    expect(events).toEqual(['start']);

    emitSidebarTransitionEnd({ propertyName: 'margin-left' } as TransitionEvent);
    expect(events).toEqual(['start', 'end']);
  });

  it('拖拽宽度禁用 CSS transition 时不会留下未结束的布局事务', async () => {
    document.body.classList.add('panel-resizing');
    useUIStore().setSidebarWidth(320);
    await nextTick();
    await nextTick();

    expect(events).toEqual(['start', 'end']);
  });
});
